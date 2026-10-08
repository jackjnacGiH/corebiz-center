-- Read-only P3 acceptance: no VACUUM, retention change, statistics reset or writes.
select current_setting('autovacuum') as autovacuum,
       current_setting('pg_net.ttl',true) as pg_net_ttl,
       stats_reset from pg_stat_database where datname=current_database();

select s.schemaname,s.relname,s.n_live_tup,s.n_dead_tup,s.last_autovacuum,
       s.last_autoanalyze,s.autovacuum_count,c.reloptions,
       pg_total_relation_size(c.oid) as total_bytes
from pg_stat_user_tables s join pg_class c on c.oid=s.relid
where s.schemaname='net' and s.relname='_http_response';

-- Usage is a sample since the last reset, not proof an index is unnecessary.
select schemaname,relname,indexrelname,idx_scan,idx_tup_read,idx_tup_fetch
from pg_stat_user_indexes where schemaname='public'
  and relname in ('orders','quotes','profiles','agents','agent_links','commissions','notifications','shipping_permissions')
order by relname,indexrelname;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public'
  and tablename in ('profiles','agents','agent_links','commissions','notifications','shipping_permissions')
order by tablename,policyname;
