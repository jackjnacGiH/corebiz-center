/** Reversible legacy attachment migration. Default is a local dry-run manifest.
 * Credentials are read from env, never logged or put in the manifest.
 * Nothing deletes old objects; retirement/rollback are explicit CLI actions. */
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const TARGET='chat-private-attachments';
const LEGACY='chat-attachments';

export function attachmentPaths(message) {
  const urls=[...(message.content??'').matchAll(/https?:\/\/[^\s)"<>]+/g)].map(match=>match[0]);
  if(typeof message.metadata?.file_url==='string')urls.push(message.metadata.file_url);
  const paths=new Map();
  for(const url of urls) {
    let parsed;try{parsed=new URL(url);}catch{continue;}
    const marker=`/storage/v1/object/public/${LEGACY}/`;
    if(parsed.pathname.startsWith(marker))paths.set(url,decodeURIComponent(parsed.pathname.slice(marker.length)));
  }
  return [...paths].map(([url,path])=>({url,path}));
}

export function rewriteAttachmentMessage(message,mapping) {
  let content=message.content??'';const metadata={...(message.metadata??{})};
  for(const {url,path,signedUrl} of mapping) {
    content=content.split(url).join(signedUrl);
    if(metadata.file_url===url) {
      delete metadata.file_url;metadata.file_bucket=TARGET;metadata.file_path=path;
    }
  }
  return {content,metadata};
}

export async function collectManifest(db) {
  const messages=[];
  for(let offset=0;;offset+=500) {
    // Include metadata-only URLs as well as markdown; don't cap at 1000 rows.
    const {data,error}=await db.from('chat_messages').select('id,conversation_id,content,metadata').order('id').range(offset,offset+499);
    if(error)throw error;
    for(const message of data??[]) {
      const attachments=attachmentPaths(message);
      if(attachments.length)messages.push({original:message,attachments,updated:null});
    }
    if((data??[]).length<500)break;
  }
  return {version:1,created_at:new Date().toISOString(),legacy_bucket:LEGACY,target_bucket:TARGET,messages,retired:false};
}

export async function migrateManifest(db,manifest,save) {
  const signed=new Map();
  for(const record of manifest.messages) {
    if(record.updated)continue;
    const mapping=[];
    for(const attachment of record.attachments) {
      if(!signed.has(attachment.path)) {
        const original=await db.storage.from(LEGACY).download(attachment.path);
        if(original.error||!original.data)throw original.error??new Error('legacy_file_missing');
        const bytes=Buffer.from(await original.data.arrayBuffer());
        const upload=await db.storage.from(TARGET).upload(attachment.path,bytes,{upsert:false,contentType:original.data.type,cacheControl:'0'});
        if(upload.error) {
          // A resumed run can find its copy. Verify bytes before trusting it.
          const existing=await db.storage.from(TARGET).download(attachment.path);
          if(existing.error||!existing.data)throw upload.error;
          const other=Buffer.from(await existing.data.arrayBuffer());
          const hash=value=>createHash('sha256').update(value).digest('hex');
          if(hash(bytes)!==hash(other))throw new Error('private_copy_conflict');
        }
        const link=await db.storage.from(TARGET).createSignedUrl(attachment.path,7*86400);
        if(link.error||!link.data?.signedUrl)throw link.error??new Error('sign_failed');
        signed.set(attachment.path,link.data.signedUrl);
      }
      mapping.push({...attachment,signedUrl:signed.get(attachment.path)});
    }
    const updated=rewriteAttachmentMessage(record.original,mapping);
    const {data,error}=await db.from('chat_messages').update(updated).eq('id',record.original.id)
      .eq('content',record.original.content).eq('metadata',JSON.stringify(record.original.metadata??{})).select('id');
    if(error)throw error;
    if(data?.length!==1)throw new Error(`message_changed:${record.original.id}`);
    record.updated=updated;await save(manifest);
  }
  return manifest;
}

export async function rollbackManifest(db,manifest,save) {
  // Restore old public access first, then restore each unchanged migrated row.
  if(manifest.retired) {
    const bucket=await db.storage.updateBucket(LEGACY,{public:true});
    if(bucket.error)throw bucket.error;
  }
  for(const record of manifest.messages) {
    if(!record.updated)continue;
    const {data,error}=await db.from('chat_messages').update({content:record.original.content,metadata:record.original.metadata})
      .eq('id',record.original.id).eq('content',record.updated.content).eq('metadata',JSON.stringify(record.updated.metadata)).select('id');
    if(error)throw error;
    if(data?.length!==1)throw new Error(`rollback_conflict:${record.original.id}`);
    record.updated=null;await save(manifest);
  }
  manifest.retired=false;await save(manifest);
}

async function main() {
  const args=process.argv.slice(2);const fileIndex=args.indexOf('--manifest');
  if(fileIndex<0||!args[fileIndex+1])throw new Error('Specify --manifest <private local backup path>');
  if(args.includes('--retire-legacy')&&!args.includes('--accept-old-customer-links-expire'))throw new Error('Retirement changes existing customer public links; specify --accept-old-customer-links-expire after owner approval');
  const manifestPath=resolve(args[fileIndex+1]);
  const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const save=value=>writeFile(manifestPath,JSON.stringify(value,null,2),{mode:0o600});
  if(!args.includes('--apply')&&!args.includes('--rollback')) {
    const manifest=await collectManifest(db);await save(manifest);
    console.log(JSON.stringify({dry_run:true,messages:manifest.messages.length,files:new Set(manifest.messages.flatMap(x=>x.attachments.map(a=>a.path))).size}));return;
  }
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.version!==1)throw new Error('Unsupported manifest');
  if(args.includes('--rollback')){await rollbackManifest(db,manifest,save);console.log('Rollback completed');return;}
  await migrateManifest(db,manifest,save);
  if(args.includes('--retire-legacy')) {
    const bucket=await db.storage.updateBucket(LEGACY,{public:false});if(bucket.error)throw bucket.error;
    manifest.retired=true;await save(manifest);
  }
  console.log(JSON.stringify({migrated:manifest.messages.length,legacy_retired:manifest.retired}));
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
