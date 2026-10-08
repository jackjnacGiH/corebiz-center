import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff } from "../_shared/staff-auth.mjs";
import { runDurableChatDelivery } from "../_shared/chat-delivery.mjs";
import { facebookOutboundTarget, facebookTextParts } from "../_shared/messenger-outbound.mjs";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:cors});
  if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const access=await requireStaff(admin,req,["owner","admin","staff"]);
  if(access.error)return reply({error:access.error},access.status);
  let input;
  try{input=await req.json();}catch{return reply({error:"invalid_json"},400);}
  if(!input||typeof input!=="object"||Array.isArray(input))return reply({error:"invalid_json"},400);
  if(!/^[0-9a-f-]{36}$/i.test(input.message_id??""))return reply({error:"invalid_message_id"},400);
  const message=await admin.from("chat_messages").select("id,conversation_id,sender_id,sender_type,sender_name,content,content_type,metadata").eq("id",input.message_id).maybeSingle();
  if(message.error)return reply({error:"database_unavailable"},503);
  if(!message.data||message.data.sender_type!=="agent")return reply({error:"message_not_found"},404);
  const savedMessage = message.data;
  if(message.data.sender_id!==access.actor.id&&!['owner','admin'].includes(access.actor.role))return reply({error:"forbidden"},403);
  const room=await admin.from("chat_conversations").select("id,channel,external_id,metadata,last_customer_message_at").eq("id",message.data.conversation_id).maybeSingle();
  if(room.error)return reply({error:"database_unavailable"},503);
  const pageId=Deno.env.get("META_PAGE_ID")??"",token=Deno.env.get("META_PAGE_ACCESS_TOKEN")??"";
  const target=facebookOutboundTarget(room.data,pageId,Deno.env.get("FACEBOOK_PUBLIC_CHANNEL_ENABLED")==="true");
  if(!token||!target)return reply({error:"facebook_channel_not_ready"},409);
  const graph=`https://graph.facebook.com/${Deno.env.get("META_GRAPH_API_VERSION")||"v26.0"}`;
  let text=message.data.content;
  if(message.data.content_type==="file"){
    const metadata=message.data.metadata??{};
    let url=metadata.file_url;
    if(metadata.file_bucket&&metadata.file_path){
      const signed=await admin.storage.from(metadata.file_bucket).createSignedUrl(metadata.file_path,7*86400);
      if(signed.error||!signed.data?.signedUrl)return reply({error:"attachment_unavailable"},503);
      url=signed.data.signedUrl;
    }
    if(!url)return reply({error:"attachment_unavailable"},409);
    text=`📎 ${metadata.file_name||'เอกสาร'}\n${url}`;
  }
  const send=async(text:string)=>{
    for(const part of facebookTextParts(text)){
      const body=target.surface==="comment"?{message:part}:{recipient:{id:target.recipient},messaging_type:"RESPONSE",message:{text:part}};
      const response=await fetch(`${graph}/${target.path}`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
      const receipt=await response.json().catch(()=>({}));
      if(!response.ok||!(receipt.id||receipt.message_id))throw new Error("facebook_delivery_unconfirmed");
    }
    return true;
  };
  try{
    const meta={staff_message_id:savedMessage.id,page_id:pageId,facebook_surface:target.surface};
    const state=await runDurableChatDelivery(admin,{channel:"messenger",eventKey:`staff.${savedMessage.id}`,
      process:async(ctx:any)=>{ctx.conversationId=savedMessage.conversation_id;await ctx.send(text,meta,send);},
      replay:async(ctx:any,row:any)=>{ctx.conversationId=row.conversation_id;await ctx.send(row.reply_text,row.reply_metadata,send);}});
    return state==="delivered"?reply({ok:true,state}):reply({error:"delivery_requires_review",state},409);
  }catch{return reply({error:"delivery_pending_review"},503);}
});
