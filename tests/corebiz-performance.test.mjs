import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { mountComponent } from './helpers/component-harness.mjs';

const snapshot = JSON.parse(readFileSync(new URL('./fixtures/corebiz-performance-policies.json', import.meta.url)));
const migration = readFileSync(new URL('../supabase/migrations/20261015034957_corebiz_list_permission_initplans.sql', import.meta.url), 'utf8');
const quote = s => `"${s.replaceAll('"', '""')}"`;
const tables = [...new Set(snapshot.all_policies.map(p => p.tablename))];
const roles = ['owner', 'admin', 'staff', 'agent', 'viewer', 'customer', 'inactive'];
const uid = i => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;

async function fixture() {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create sequence public.uid_calls;
      create function auth.uid() returns uuid language plpgsql stable as $$ begin
        perform nextval('public.uid_calls'); return nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      end $$;
      grant usage on schema auth to anon,authenticated;
      grant usage on sequence public.uid_calls to anon,authenticated;
      create table public.profiles(id uuid primary key,role text,is_active boolean);`);
    for (const [i,role] of roles.entries()) await db.query('insert into profiles values($1,$2,$3)', [uid(i), role === 'inactive' ? 'staff' : role, role !== 'inactive']);
    for (const helper of snapshot.helpers) await db.exec(helper.definition);
    await db.exec(`create function public.can_delete() returns boolean language sql stable security definer set search_path=public as $$
      select exists(select 1 from profiles where id=auth.uid() and is_active and role in ('owner','admin')) $$;`);
    for (const table of tables) await db.exec(`create table public.${table}(id int primary key,value text,total_spent numeric default 0,status text default 'active',is_active boolean default true,recipient_id uuid);
      insert into public.${table}(id,value) select i,'row-'||i from generate_series(1,80) i;
      alter table public.${table} enable row level security;
      grant select,insert,update,delete on public.${table} to anon,authenticated;`);
    for (const p of snapshot.all_policies) {
        const roleList = Array.isArray(p.roles) ? p.roles.map(quote).join(',') : p.roles.slice(1,-1).split(',').map(quote).join(',');
        await db.exec(`create policy ${quote(p.policyname)} on public.${p.tablename} for ${p.cmd} to ${roleList}
          ${p.qual ? `using (${p.qual})` : ''} ${p.with_check ? `with check (${p.with_check})` : ''}`);
    }
    return db;
}

async function attempt(db, role, sql) {
    await db.exec('begin');
    try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [role === 'anon' ? '' : uid(roles.indexOf(role))]);
        await db.exec(`set local role ${role === 'anon' ? 'anon' : 'authenticated'}`);
        return (await db.query(sql)).rows;
    } catch(e) { return {error:e.code}; }
    finally { await db.exec('rollback'); }
}

async function outcomes(db) {
    const result = {};
    for (const role of [...roles,'anon']) {
        result[role] = {};
        for (const table of tables) result[role][table] = {
            read: await attempt(db,role,`select id from public.${table} order by id`),
            insert: await attempt(db,role,`insert into public.${table}(id,value) values(500,'test') returning id`),
            update: await attempt(db,role,`update public.${table} set value='test' where id=1 returning id`),
            delete: await attempt(db,role,`delete from public.${table} where id=1 returning id`),
        };
    }
    return result;
}

test('performance policy changes preserve every role, row and write outcome and are idempotent', async () => {
    const db = await fixture();
    try {
        const before = await outcomes(db);
        const catalog = async () => (await db.query("select tablename,policyname,cmd,roles,permissive,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname")).rows;
        const oldPolicies = await catalog();
        await db.exec(migration);
        assert.deepEqual(await outcomes(db),before);
        const newPolicies = await catalog();
        assert.deepEqual(newPolicies.map(({qual,...p})=>p),oldPolicies.map(({qual,...p})=>p));
        const targets = new Set(snapshot.policies.map(p=>p.policyname));
        assert.equal(newPolicies.filter(p=>targets.has(p.policyname)&&p.qual.includes('SELECT')).length,13);
        assert.deepEqual(newPolicies.filter(p=>!targets.has(p.policyname)),oldPolicies.filter(p=>!targets.has(p.policyname)));
        assert.equal(before.owner.products.read.length,80);
        assert.equal(before.viewer.products.read.length,80);
        assert.deepEqual(before.viewer.products.update,[]);
        assert.deepEqual(before.inactive.customers.read,[]);
        assert.deepEqual(before.anon.customers.read,[]);
        await db.exec(migration);
        assert.deepEqual(await catalog(),newPolicies);
    } finally { await db.close(); }
});

test('unexpected policy or helper drift rolls back the entire performance change', async () => {
    const db = await fixture();
    try {
        await db.exec('alter policy warehouses_read_all on public.warehouses using(true)');
        await assert.rejects(db.exec(migration),/corebiz_performance_review_required:policy/);
        assert.equal((await db.query("select qual from pg_policies where policyname='products_read_all'")).rows[0].qual,'can_read()');
        await db.exec('alter function public.can_read() volatile');
        await assert.rejects(db.exec(migration),/corebiz_performance_review_required:helper/);
    } finally { await db.close(); }
});

test('same list query checks request-stable permissions once rather than per scanned row', async t => {
    const db = await fixture();
    try {
        await db.exec("insert into customers(id,value) select i,'row-'||i from generate_series(81,5000) i; analyze customers");
        const measure = async () => {
            await db.exec('alter sequence public.uid_calls restart with 1');
            const rows = await attempt(db,'owner','select id from public.customers order by total_spent desc,id asc');
            const calls = Number((await db.query('select last_value from public.uid_calls')).rows[0].last_value);
            const plan = await attempt(db,'owner','explain (analyze,format json) select id from public.customers order by total_spent desc,id asc');
            return {rowCount:rows.length,calls,ms:plan[0]['QUERY PLAN'][0]['Execution Time']};
        };
        const before = await measure();
        await db.exec(migration);
        const after = await measure();
        assert.equal(before.rowCount,5000);
        assert.equal(after.rowCount,before.rowCount);
        assert.ok(before.calls>=5000);
        assert.ok(after.calls<=2);
        const evidence = {scope:'Local PostgreSQL fixture; timing is not end-user latency',before,after};
        mkdirSync('output/performance-2026-10-15',{recursive:true});
        writeFileSync('output/performance-2026-10-15/permission-fixture.json',`${JSON.stringify(evidence,null,2)}\n`);
        t.diagnostic(JSON.stringify(evidence));
    } finally { await db.close(); }
});

test('the customer page index returns identical rows in order and removes the full-table sort', async () => {
    const db = await fixture();
    try {
        await db.exec("insert into customers(id,total_spent) select i,i%50 from generate_series(81,5000) i; analyze customers");
        const sql = 'select id from public.customers order by total_spent desc,id asc limit 100';
        const before = await attempt(db,'owner',sql);
        await db.exec(migration);
        assert.deepEqual(await attempt(db,'owner',sql),before);
        const plan = (await attempt(db,'owner',`explain (analyze,format json) ${sql}`))[0]['QUERY PLAN'][0];
        const nodes = n => [n,...(n.Plans??[]).flatMap(nodes)];
        assert.ok(nodes(plan.Plan).some(n=>n['Index Name']==='customers_spent_page_idx'));
        assert.ok(!nodes(plan.Plan).some(n=>n['Node Type']==='Sort'));
    } finally { await db.close(); }
});

test('deferred tools mount only on first open, keep state across close and reopen, and update props', () => {
    const a = {type:'Tool',props:{value:1}};
    const component = mountComponent('frontend/src/components/DeferredContent.tsx',{active:false,children:a});
    assert.equal(component.tree,null);
    assert.equal(component.render({active:true,children:a}).props.children,a);
    assert.equal(component.render({active:false,children:a}).props.children,a);
    const b = {type:'Tool',props:{value:2}};
    assert.equal(component.render({active:true,children:b}).props.children,b);
    component.unmount();
});
