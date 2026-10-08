import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const securitySql=readFileSync(new URL('../supabase/migrations/20261008051302_audit_security_knowledge_storage.sql',import.meta.url),'utf8');
const searchSql=readFileSync(new URL('../supabase/migrations/20261008051614_audit_storefront_filtered_search.sql',import.meta.url),'utf8');
const OWNER='00000000-0000-4000-8000-000000000001';
const STAFF='00000000-0000-4000-8000-000000000002';
const VIEWER='00000000-0000-4000-8000-000000000003';

async function bootstrap() {
  const db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
    grant usage on schema auth to authenticated,service_role;
    create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid);
    create table profiles(id uuid primary key,role text,is_active boolean default true,full_name text,avatar_url text,phone text,language text,updated_at timestamptz default now());
    insert into profiles(id,role)values('${OWNER}','owner'),('${STAFF}','staff'),('${VIEWER}','viewer');
    create function can_delete()returns boolean language sql stable security definer as $$ select exists(select 1 from profiles where id=auth.uid() and is_active and role in('owner','admin')) $$;
    create function is_staff()returns boolean language sql stable security definer as $$ select exists(select 1 from profiles where id=auth.uid() and is_active and role in('owner','admin','staff')) $$;
    create function can_read()returns boolean language sql stable security definer as $$ select exists(select 1 from profiles where id=auth.uid() and is_active and role in('owner','admin','staff','agent','viewer')) $$;
    create table line_channels(id uuid primary key,name text,channel_id text,is_active boolean,notes text,created_at timestamptz default now(),updated_at timestamptz default now(),channel_access_token text,channel_secret text);
    grant select on line_channels to authenticated;
    insert into line_channels(id,name,is_active,channel_access_token,channel_secret)values('${OWNER}','Audit channel',true,'never-return-token','never-return-secret');
    create table knowledge_chunks(id uuid primary key default gen_random_uuid(),source_path text,source_type text,category text,title text,content text not null,metadata jsonb,embedding text,language text,chunk_index integer,content_hash text,token_count integer,tags text[],visibility text,embedding_model text,embedding_dimensions integer,embedding_version text,embedded_at timestamptz,unique(source_path,chunk_index));
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text,name text);
    alter table storage.objects enable row level security;
  `);
  await db.exec(securitySql);
  return db;
}

async function identity(db,id,role='authenticated') {
  await db.exec(`select set_config('request.jwt.claim.sub','${id}',false);select set_config('request.jwt.claim.role','${role}',false);`);
}

test('inactive user cannot reactivate/change identity; ordinary self details still work',async()=>{
  const db=await bootstrap();try {
    await identity(db,STAFF);
    await db.exec(`update profiles set full_name='allowed' where id='${STAFF}';`);
    await assert.rejects(db.exec(`update profiles set role='owner' where id='${STAFF}';`),/profile_identity_update_forbidden/);
    await identity(db,OWNER);
    await db.exec(`update profiles set is_active=false where id='${STAFF}';`);
    await identity(db,STAFF);
    await assert.rejects(db.exec(`update profiles set is_active=true where id='${STAFF}';`),/profile_identity_update_forbidden/);
    assert.equal((await db.query(`select is_active from profiles where id='${STAFF}'`)).rows[0].is_active,false);
  } finally {await db.close();}
});

test('LINE metadata remains readable while credentials SELECT is denied',async()=>{
  const db=await bootstrap();try {
    await identity(db,VIEWER);await db.exec('set role authenticated');
    const metadata=(await db.query('select * from list_line_channel_metadata()')).rows[0];
    assert.equal(metadata.token_configured,true);assert.equal(metadata.name,'Audit channel');
    assert.equal('channel_access_token' in metadata,false);assert.equal('channel_secret' in metadata,false);
    await assert.rejects(db.exec('select channel_access_token from line_channels'),/permission denied/);
    await db.exec('reset role');
  } finally {await db.close();}
});

test('knowledge transaction rolls back deletion/revision on a late duplicate and retains prior version on success',async()=>{
  const db=await bootstrap();try {
    await db.exec("insert into knowledge_chunks(source_path,source_type,content,chunk_index,embedding) values('faq.md','manual','old answer',0,'[1]');");
    await identity(db,OWNER,'service_role');
    const row={source_path:'faq.md',source_type:'manual',content:'new answer',chunk_index:0,embedding:'[2]',content_hash:'new'};
    await assert.rejects(db.query('select * from replace_knowledge_atomic($1,$2,$3)', ['faq.md',JSON.stringify([row,row]),OWNER]),/duplicate key/);
    assert.equal((await db.query('select content from knowledge_chunks')).rows[0].content,'old answer');
    assert.equal((await db.query('select count(*)::int n from knowledge_revisions')).rows[0].n,0);
    await db.query('select * from replace_knowledge_atomic($1,$2,$3)',['faq.md',JSON.stringify([row]),OWNER]);
    assert.equal((await db.query('select content from knowledge_chunks')).rows[0].content,'new answer');
    const previous=(await db.query('select previous_chunks from knowledge_revisions')).rows[0].previous_chunks;
    assert.equal(previous[0].content,'old answer');
    await identity(db,VIEWER,'service_role');
    await assert.rejects(db.query('select * from replace_knowledge_atomic($1,$2,$3)',['faq.md',JSON.stringify([row]),VIEWER]),/forbidden/);
  } finally {await db.close();}
});

test('embedding budget stops repeated spend and session revoke denies authenticated callers',async()=>{
  const db=await bootstrap();try {
    await identity(db,OWNER,'service_role');
    for(let i=0;i<3;i++)assert.equal((await db.query('select consume_embedding_budget_internal($1,200000) ok',[OWNER])).rows[0].ok,true);
    assert.equal((await db.query('select consume_embedding_budget_internal($1,1) ok',[OWNER])).rows[0].ok,false);
    await db.query('insert into auth.sessions(user_id)values($1)',[STAFF]);
    await identity(db,OWNER);await db.exec('set role authenticated');
    await assert.rejects(db.query('select revoke_user_sessions_internal($1)',[STAFF]),/permission denied/);
    await db.exec('reset role');await identity(db,OWNER,'service_role');
    assert.equal((await db.query('select revoke_user_sessions_internal($1) n',[STAFF])).rows[0].n,1);
  } finally {await db.close();}
});

test('server filtered catalog matches previous word semantics and reduces returned fixture payload',async()=>{
  const db=new PGlite();try {
    await db.exec(`create role anon;create role authenticated;
      create table fixture_products(id uuid,sku text,name_th text,name_en text,brand text,group_name text,category_name_th text,tags text[],feature_tags text[],is_featured boolean,description_th text);
      create view storefront_products with(security_invoker=true)as select * from fixture_products;
      insert into fixture_products select md5(i::text)::uuid,i::text,
        case when i%50=0 then 'ผ้าทราย PACO Y966' else 'กระดาษทราย DEERFOS SA331' end,null,null,null,null,'{}','{}',false,repeat('รายละเอียด ',80)
      from generate_series(1,2500)i;
      grant select on storefront_products,fixture_products to anon,authenticated;`);
    await db.exec(searchSql);
    const all=(await db.query('select * from storefront_products')).rows;
    const before=Buffer.byteLength(JSON.stringify(all));
    const afterRows=(await db.query('select * from search_storefront_products($1,0,1000)',['PACO Y966'])).rows;
    const after=Buffer.byteLength(JSON.stringify(afterRows));
    assert.equal(afterRows.length,50);
    assert.ok(before/after > 49);
    assert.equal((await db.query('select * from search_storefront_products($1,0,1000)',["PACO'); drop table fixture_products;--"])).rows.length,0);
    const next=(await db.query('select * from search_storefront_products($1,1000,1000)',['กระดาษทราย'])).rows;
    assert.equal(next.length,1000);
    console.log(`Catalog fixture baseline: ${all.length} -> ${afterRows.length} rows, ${before} -> ${after} bytes (${(100*(1-after/before)).toFixed(2)}% less)`);
  }finally{await db.close();}
});
