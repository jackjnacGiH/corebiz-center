/**
 * Quick connection test for Supabase service_role.
 * Run: npx tsx test-supabase.ts
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log('Testing Supabase connection...');
  console.log(`URL: ${SUPABASE_URL}`);

  // Test 1: read categories (RLS bypass via service_role)
  const { data: cats, error: catErr } = await supabase
    .from('categories').select('slug,name_th').limit(10);
  if (catErr) throw catErr;
  console.log(`\n✓ Read ${cats?.length ?? 0} categories:`);
  cats?.forEach(c => console.log(`  - ${c.slug} (${c.name_th})`));

  // Test 2: read warehouses
  const { data: whs, error: whErr } = await supabase
    .from('warehouses').select('code,name').limit(5);
  if (whErr) throw whErr;
  console.log(`\n✓ Read ${whs?.length ?? 0} warehouses:`);
  whs?.forEach(w => console.log(`  - ${w.code}: ${w.name}`));

  // Test 3: count knowledge_chunks (should be 0 — no sync yet)
  const { count, error: kcErr } = await supabase
    .from('knowledge_chunks').select('*', { count: 'exact', head: true });
  if (kcErr) throw kcErr;
  console.log(`\n✓ knowledge_chunks rows: ${count ?? 0}`);

  console.log('\n─────────────────────────────────────');
  console.log('✅ Supabase connection works!');
}

main().catch(err => {
  console.error('\n✗ Test failed:', err.message ?? err);
  process.exit(1);
});
