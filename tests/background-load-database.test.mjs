import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20261020065725_background_load_reduction.sql',import.meta.url),'utf8');
const uid = '00000000-0000-4000-8000-000000000001';
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema pricing_private; create schema cron; create schema net; create schema vault; create schema storage;
    create table public.agent_tasks(id uuid default gen_random_uuid() primary key,category text,kind text,title text,summary text,recommendation text,payload jsonb,action_kind text,requires_approval boolean,priority smallint,related_type text,related_id text,dedupe_key text unique,source text,status text default 'proposed',updated_at timestamptz default now());
    create table public.update_counter(n int); insert into public.update_counter values(0);
    create function public.count_update() returns trigger language plpgsql as $$ begin update public.update_counter set n=n+1; return new; end $$;
    create trigger count_update after update on public.agent_tasks for each row execute function public.count_update();
    create table public.profiles(id uuid,role text,is_active boolean);
    insert into public.profiles values('${uid}','owner',true);
    create table public.notifications(recipient_id uuid,type text,title text,body text,link text,metadata jsonb,created_at timestamptz default statement_timestamp());
    create table pricing_private.flowaccount_mcp_connections(status text,last_error_code text,updated_at timestamptz default now());
    create table vault.secrets(name text,secret text,created_at timestamptz default now());
    create view vault.decrypted_secrets as select name,secret as decrypted_secret,created_at from vault.secrets;
    create function vault.create_secret(secret text,name text) returns uuid language sql as $$ insert into vault.secrets values(name,secret,now()) returning gen_random_uuid() $$;
    create sequence public.http_calls;
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer default 5000) returns bigint language sql as $$ select nextval('public.http_calls') $$;
    create table public.inventory_sync_logs(id uuid primary key,started_at timestamptz,finished_at timestamptz,status text,details jsonb);
    create table cron.job_run_details(runid bigint primary key,start_time timestamptz,end_time timestamptz,status text);
    create table storage.objects(bucket_id text,name text);
    insert into vault.secrets values('FLOWACCOUNT_MCP_REFRESH_TOKEN','fixture',now()),('FLOWACCOUNT_MCP_SYNC_KEY','fixture',now());`);
  await db.exec(migration);
  return db;
}

test('same AI proposal writes zero updates; changed and closed proposals preserve behavior',async()=>{
  const db=await fixture();
  try {
    const propose = (title) => db.query(`select public.agent_propose('ops','ops.test',$1,p_dedupe_key:='fixture') as id`,[title]);
    const first=(await propose('same')).rows[0].id;
    assert.equal((await propose('same')).rows[0].id,first);
    assert.equal((await db.query('select n from public.update_counter')).rows[0].n,0);
    await propose('changed');
    assert.equal((await db.query('select n from public.update_counter')).rows[0].n,1);
    await db.exec("update public.agent_tasks set status='approved'");
    assert.equal((await propose('ignored')).rows[0].id,first);
    assert.equal((await db.query('select title from public.agent_tasks')).rows[0].title,'changed');
  } finally { await db.close(); }
});

test('persistent OAuth error stops HTTP and alerts once; reconnect and transient failures still sync',async()=>{
  const db=await fixture();
  try {
    await db.exec("insert into pricing_private.flowaccount_mcp_connections(status,last_error_code) values('connected','oauth_configuration_invalid')");
    for(let i=0;i<2;i++) assert.equal((await db.query('select public.run_flowaccount_price_sync_internal() as id')).rows[0].id,null);
    assert.equal((await db.query('select count(*)::int as n from public.notifications')).rows[0].n,1);
    assert.equal((await db.query('select is_called from public.http_calls')).rows[0].is_called,false);
    await db.exec('update pricing_private.flowaccount_mcp_connections set last_error_code=null');
    assert.equal(Number((await db.query('select public.run_flowaccount_price_sync_internal() as id')).rows[0].id),1);
    await db.exec("update pricing_private.flowaccount_mcp_connections set last_error_code='provider_unavailable'");
    assert.equal(Number((await db.query('select public.run_flowaccount_price_sync_internal() as id')).rows[0].id),2);
  } finally { await db.close(); }
});

test('history requires backup object; changed, recent and unfinished records survive pruning',async()=>{
  const db=await fixture();
  try {
    await db.exec(`insert into public.inventory_sync_logs values('${uid}',now()-interval '100 days',now()-interval '100 days','success','{}');
      insert into cron.job_run_details values(1,now()-interval '100 days',now()-interval '100 days','succeeded'),(2,now(),now(),'succeeded'),(3,now()-interval '100 days',null,'running');`);
    const cutoff = new Date(Date.now()-61*86400_000).toISOString();
    const rows=(await db.query("select public.read_history_archive_batch('inventory',$1) as rows",[cutoff])).rows[0].rows;
    const hash='a'.repeat(64),path=`inventory/2026-01-01/${hash}.json.gz`;
    const commit = (prune=true) => db.query('select public.commit_history_archive_batch($1,$2,$3,$4,$5,100,$6) as result',['inventory',cutoff,JSON.stringify(rows),path,hash,prune]);
    await assert.rejects(commit(),/object_missing/);
    await db.query("insert into storage.objects values('maintenance-history',$1)",[path]);
    assert.equal((await commit(false)).rows[0].result.deleted_rows,0);
    await db.exec(`update public.inventory_sync_logs set details='{"changed":true}'`);
    assert.equal((await commit()).rows[0].result.deleted_rows,0);
    assert.equal((await db.query('select count(*)::int as n from public.inventory_sync_logs')).rows[0].n,1);
    await db.exec("update public.inventory_sync_logs set details='{}'");
    assert.equal((await commit()).rows[0].result.deleted_rows,1);
    assert.equal((await commit()).rows[0].result.deleted_rows,0);
    const cronRows=(await db.query("select public.read_history_archive_batch('cron',$1) as rows",[cutoff])).rows[0].rows;
    assert.deepEqual(cronRows.map(r=>r.runid),[1]);
    const cronPath=`cron/2026-01-01/${hash}.json.gz`;
    await db.query("insert into storage.objects values('maintenance-history',$1)",[cronPath]);
    await db.query('select public.commit_history_archive_batch($1,$2,$3,$4,$5,100,true)',['cron',cutoff,JSON.stringify(cronRows),cronPath,hash]);
    assert.deepEqual((await db.query('select runid from cron.job_run_details order by runid')).rows.map(r=>r.runid),[2,3]);
    await assert.rejects(db.query("select public.read_history_archive_batch('inventory',now())"),/invalid_history_archive_request/);
    await assert.rejects(db.query("select public.read_history_archive_batch('chat_messages',$1)",[cutoff]),/invalid_history_archive_source/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.get_maintenance_archive_key()'),/permission denied/);
    await assert.rejects(db.query("select public.read_history_archive_batch('inventory',$1)",[cutoff]),/permission denied/);
  } finally { await db.close(); }
});
