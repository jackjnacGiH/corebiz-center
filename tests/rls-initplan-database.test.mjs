import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const snapshot=JSON.parse(await readFile(new URL('./fixtures/rls-initplan-live-policies.json',import.meta.url),'utf8'));
const migration=await readFile(new URL('../supabase/migrations/20261008060813_rls_request_initplans.sql',import.meta.url),'utf8');
const securitySource=await readFile(new URL('../supabase/migrations/20261008051302_audit_security_knowledge_storage.sql',import.meta.url),'utf8');
const profileGuard=securitySource.slice(0,securitySource.indexOf('-- Auth JWTs already issued'));
const roles=['owner','admin','staff','agent','viewer','customer','inactive'];
const uid=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const users=Object.fromEntries(roles.map((role,index)=>[role,uid(index+1)]));
const quoteIdent=(name)=>`"${name.replaceAll('"','""')}"`;

async function fixture() {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema shipping_private;
      create sequence public.uid_call_counter;
      create function auth.uid() returns uuid language plpgsql stable as $$ begin
        perform nextval('public.uid_call_counter');
        return nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      end $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
      grant usage on schema auth,shipping_private to anon,authenticated;
      grant usage on sequence public.uid_call_counter to anon,authenticated;
      create table public.profiles(id uuid primary key,role text not null,is_active boolean not null,full_name text,avatar_url text,phone text,language text,updated_at timestamptz default now());
      create table public.agents(id uuid primary key,user_id uuid,name text);
      create table public.agent_links(id uuid primary key,agent_id uuid references public.agents);
      create table public.commissions(id uuid primary key,agent_id uuid references public.agents);
      create table public.notifications(id uuid primary key,recipient_id uuid,is_read boolean default false);
      create table public.shipping_permissions(user_id uuid primary key);
      grant select,update on all tables in schema public to anon,authenticated;`);
    for (const [role,id] of Object.entries(users)) {
      await db.query('insert into public.profiles(id,role,is_active,full_name) values($1,$2,$3,$4)',[id,role==='inactive'?'staff':role,role!=='inactive',role]);
      await db.query('insert into public.notifications(id,recipient_id) values($1,$2)',[uid(100+roles.indexOf(role)),id]);
      await db.query('insert into public.shipping_permissions(user_id) values($1)',[id]);
    }
    await db.query('insert into public.notifications(id,recipient_id) values($1,null)',[uid(199)]);
    for (const [index,role] of ['agent','viewer','customer','inactive'].entries()) {
      await db.query('insert into public.agents(id,user_id,name) values($1,$2,$3)',[uid(200+index),users[role],role]);
      await db.query('insert into public.agent_links(id,agent_id) values($1,$2)',[uid(300+index),uid(200+index)]);
      await db.query('insert into public.commissions(id,agent_id) values($1,$2)',[uid(400+index),uid(200+index)]);
    }
    for (const helper of snapshot.helpers) await db.exec(helper.definition);
    await db.exec(`create function public.is_owner() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.profiles where id=auth.uid() and is_active and role='owner') $$;`);
    for (const table of ['profiles','agents','agent_links','commissions','notifications','shipping_permissions']) await db.exec(`alter table public.${table} enable row level security`);
    for (const policy of snapshot.policies) {
      await db.exec(`create policy ${quoteIdent(policy.policyname)} on public.${quoteIdent(policy.tablename)} for ${policy.cmd} to authenticated using(${policy.qual})${policy.with_check===null?'':` with check(${policy.with_check})`}`);
    }
    // Existing overlapping staff/owner policies remain unchanged; this task
    // does not consolidate them or narrow/expand access.
    await db.exec(`create policy profiles_owner_all on public.profiles for all to authenticated using(public.is_owner()) with check(public.is_owner());`);
    for (const table of ['agents','agent_links','commissions']) await db.exec(`create policy ${table}_staff_all on public.${table} for all to authenticated using(public.is_staff()) with check(public.is_staff())`);
    await db.exec(profileGuard);
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function asUser(db,role,sql,params=[]) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${users[role]??''}',false); select set_config('request.jwt.claim.role','${role==='anon'?'anon':'authenticated'}',false); set role ${role==='anon'?'anon':'authenticated'};`);
  try { return (await db.query(sql,params)).rows; } finally { await db.exec('reset role'); }
}
async function attempt(db,role,sql,params=[]) {
  try { return {rows:await asUser(db,role,sql,params)}; }
  catch(error) { return {error:error.code}; }
}
async function catalog(db) {
  return (await db.query('select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname=$1 order by tablename,policyname',['public'])).rows;
}
async function roleResults(db) {
  const result={};
  for (const role of [...roles,'anon']) {
    const reads={};
    for (const table of ['profiles','agents','agent_links','commissions','notifications']) reads[table]=await asUser(db,role,`select id::text from public.${table} order by id`);
    reads.shipping_permissions=await asUser(db,role,'select user_id::text from public.shipping_permissions order by user_id');
    const writes={
      ownName:await attempt(db,role,'update public.profiles set full_name=$1 where id=$2 returning id::text',['renamed',users[role]??users.customer]),
      notifications:await attempt(db,role,'update public.notifications set is_read=true returning id::text'),
    };
    if (!['owner','admin','anon'].includes(role)) {
      writes.identity=await attempt(db,role,'update public.profiles set is_active=true,role=$1 where id=$2 returning id::text',['owner',users[role]]);
    }
    result[role]={reads,writes};
  }
  return result;
}

test('seven optimized policies and one guarded exception preserve roles, actions, boundaries and the profile identity guard', async()=> {
  const db=await fixture();
  try {
    const originalCatalog=await catalog(db);
    const before=await roleResults(db);
    await db.exec(migration);
    const after=await roleResults(db);
    assert.deepEqual(after,before);
    assert.equal(after.agent.reads.agents.length,1);
    assert.equal(after.agent.reads.agent_links.length,1);
    assert.equal(after.customer.reads.commissions.length,1,'existing own-agent link semantics remain unchanged');
    assert.equal(after.staff.reads.notifications.length,2,'own plus broadcast only');
    assert.equal(after.viewer.reads.notifications.length,0);
    assert.equal(after.inactive.reads.notifications.length,0);
    assert.equal(after.customer.writes.identity.error,'42501');
    assert.equal(after.inactive.writes.identity.error,'42501');
    assert.equal(after.anon.reads.profiles.length,0);
    const updatedCatalog=await catalog(db);
    assert.deepEqual(updatedCatalog.map(({qual,with_check,...metadata})=>metadata),originalCatalog.map(({qual,with_check,...metadata})=>metadata));
    const targets=new Set(snapshot.policies.map(p=>`${p.tablename}.${p.policyname}`));
    assert.deepEqual(updatedCatalog.filter(p=>!targets.has(`${p.tablename}.${p.policyname}`)),originalCatalog.filter(p=>!targets.has(`${p.tablename}.${p.policyname}`)));
    assert.equal(updatedCatalog.filter(p=>targets.has(`${p.tablename}.${p.policyname}`)&&p.qual.includes('SELECT auth.uid()')).length,7);
    assert.deepEqual(updatedCatalog.find(p=>p.policyname==='profiles_self_read'),originalCatalog.find(p=>p.policyname==='profiles_self_read'));
    // A permitted old notification cannot be reassigned to another recipient.
    const denied=await attempt(db,'staff','update public.notifications set recipient_id=$1 where id=$2 returning id',[users.customer,uid(102)]);
    assert.equal(denied.error,'42501');
    await db.exec(migration);
    assert.deepEqual(await roleResults(db),after,'migration rerun keeps the same access behavior');
  } finally { await db.close(); }
});

test('profile read scalar caching would recurse through the role CHECK; the guarded exception avoids that regression',async()=> {
  const db=await fixture();
  try {
    await db.exec('alter policy profiles_self_read on public.profiles using(id=(select auth.uid()) or is_staff())');
    const broken=await attempt(db,'customer','update public.profiles set full_name=$1 where id=$2 returning id',['name',users.customer]);
    assert.equal(broken.error,'42P17','actual PostgreSQL recursion regression, not a speculative exception');
    await assert.rejects(db.exec(migration),/rls_initplan_review_required:profile_read_sublink/);
    const originalRead=snapshot.policies.find(p=>p.policyname==='profiles_self_read').qual;
    await db.exec(`alter policy profiles_self_read on public.profiles using(${originalRead})`);
    await db.exec(migration);
    const fixed=await attempt(db,'customer','update public.profiles set full_name=$1 where id=$2 returning id',['name',users.customer]);
    assert.equal(fixed.rows.length,1);
  } finally { await db.close(); }
});

test('initplan preflight rejects policy/role/helper drift and rolls back all earlier ALTER POLICY statements',async()=> {
  const db=await fixture();
  try {
    await db.exec('alter policy "Staff can view their notifications" on public.notifications using(true)');
    const before=await catalog(db);
    await assert.rejects(db.exec(migration),/rls_initplan_review_required:definition_changed/);
    assert.deepEqual(await catalog(db),before);
    await db.exec(`alter policy "Staff can view their notifications" on public.notifications using(is_staff() and (recipient_id is null or recipient_id=auth.uid())); alter policy shipping_permissions_read on public.shipping_permissions to anon;`);
    const changedRoles=await catalog(db);
    await assert.rejects(db.exec(migration),/rls_initplan_review_required:definition_changed/);
    assert.deepEqual(await catalog(db),changedRoles);
    await db.exec('alter policy shipping_permissions_read on public.shipping_permissions to authenticated; alter function shipping_private.can_manage() volatile');
    await assert.rejects(db.exec(migration),/rls_initplan_review_required:request_helper_changed/);
  } finally { await db.close(); }
});

test('EXPLAIN and sequence instrumentation measure auth.uid calls before/after scalar initplan with identical results',async(t)=> {
  const db=await fixture();
  try {
    // Isolate the exact self policy when measuring UID calls; the equivalence
    // test above retains and verifies all overlapping production-style policies.
    await db.exec('drop policy agents_staff_all on public.agents');
    await db.exec("insert into public.agents(id,user_id,name) select gen_random_uuid(),gen_random_uuid(),'other' from generate_series(1,5000); analyze public.agents;");
    async function measure() {
      await db.exec("select setval('public.uid_call_counter',1,false)");
      const rows=await asUser(db,'agent','explain (analyze,buffers,format json) select count(*) from public.agents');
      const calls=(await db.query("select case when is_called then last_value else 0 end as calls from public.uid_call_counter")).rows[0].calls;
      return {calls:Number(calls),plan:rows[0]['QUERY PLAN'][0]};
    }
    const before=await measure();
    const beforeRows=await asUser(db,'agent','select count(*)::int as count from public.agents');
    await db.exec(migration);
    const after=await measure();
    const afterRows=await asUser(db,'agent','select count(*)::int as count from public.agents');
    assert.deepEqual(afterRows,beforeRows);
    assert.equal(afterRows[0].count,1);
    assert.ok(before.calls>=5000);
    assert.equal(after.calls,1);
    const nodes=(plan)=>[plan,...(plan.Plans??[]).flatMap(nodes)];
    assert.ok(nodes(after.plan.Plan).some(node=>node['Parent Relationship']==='InitPlan'));
    const evidence={verified_at:snapshot.verified_at,fixture:'5004 agents, agents_self_read isolated, PostgreSQL STABLE uid with sequence call counter',scope:'local fixture only; no production latency claim',policiesVerified:8,policiesOptimized:7,
      exception:{policy:'profiles_self_read',reason:'scalar read sublink causes42P17 through the existing same-table update role CHECK; exact original read condition retained; real PostgreSQL regression test'},sameAuthorizedCount:afterRows[0].count,
      before:{authUidCalls:before.calls,executionMs:before.plan['Execution Time'],explain:before.plan},
      after:{authUidCalls:after.calls,executionMs:after.plan['Execution Time'],explain:after.plan}};
    const directory=new URL('../output/audit-three-groups/',import.meta.url);
    await mkdir(directory,{recursive:true});
    await writeFile(new URL('rls-initplan-measurement.json',directory),JSON.stringify(evidence,null,2)+'\n');
    await writeFile(new URL('rls-initplan-live-policy-evidence.json',directory),JSON.stringify(snapshot,null,2)+'\n');
    t.diagnostic(JSON.stringify({authUidCalls:[before.calls,after.calls],executionMs:[before.plan['Execution Time'],after.plan['Execution Time']],sameAuthorizedCount:1,initPlan:true,fixtureOnly:true}));
  } finally { await db.close(); }
});
