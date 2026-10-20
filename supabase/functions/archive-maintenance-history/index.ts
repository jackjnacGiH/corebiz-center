import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.2';
import { archiveVerifiedBatch } from '../_shared/history-archive.ts';

const BUCKET = 'maintenance-history';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const equal = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const provided = req.headers.get('x-maintenance-key') ?? '';
  if (!/^[a-f0-9]{64}$/.test(provided)) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const key = await admin.rpc('get_maintenance_archive_key');
    if (key.error || typeof key.data !== 'string' || !equal(provided, key.data)) {
      return json({ error: 'unauthorized' }, 401);
    }
    if (Number(req.headers.get('content-length') ?? 0) > 1024) return json({ error: 'bad_request' }, 400);
    const body = await req.json();
    const dryRun = body?.dry_run === true;
    const archiveOnly = body?.archive_only === true;
    const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();
    const results: unknown[] = [];
    if (!dryRun) {
      const bucket = await admin.storage.getBucket(BUCKET);
      if (bucket.error) {
        if (String(bucket.error.status) !== '404' && bucket.error.message !== 'Bucket not found') throw new Error('bucket_lookup_failed');
        const created = await admin.storage.createBucket(BUCKET, { public: false });
        if (created.error) throw new Error('bucket_creation_failed');
      } else if (bucket.data.public) throw new Error('archive_bucket_must_be_private');
    }
    // Bound each invocation's work. A backlog is drained through additional runs.
    for (const source of ['inventory', 'cron']) {
      for (let batch = 0; batch < (dryRun || archiveOnly ? 1 : 2); batch++) {
        const read = await admin.rpc('read_history_archive_batch', { p_source: source, p_cutoff: cutoff, p_limit: 500 });
        if (read.error || !Array.isArray(read.data)) throw new Error('archive_read_failed');
        if (dryRun) { results.push({ source, candidate_rows: read.data.length }); break; }
        if (!read.data.length) break;
        const result = await archiveVerifiedBatch({
          source, cutoff, rows: read.data,
          upload: async (path, bytes) => {
            const uploaded = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/gzip', upsert: false });
            if (uploaded.error && String(uploaded.error.statusCode) !== '409' && !uploaded.error.message.includes('already exists')) {
              throw new Error('archive_upload_failed');
            }
          },
          download: async (path) => {
            const downloaded = await admin.storage.from(BUCKET).download(path);
            if (downloaded.error || !downloaded.data) throw new Error('archive_download_failed');
            return new Uint8Array(await downloaded.data.arrayBuffer());
          },
          commit: async (archive) => {
            const committed = await admin.rpc('commit_history_archive_batch', {
              p_source: source, p_cutoff: cutoff, p_rows: archive.rows, p_object_path: archive.objectPath,
              p_sha256: archive.sha256, p_bytes: archive.byteLength, p_delete: !archiveOnly,
            });
            if (committed.error) throw new Error('archive_commit_failed');
            return committed.data;
          },
        });
        results.push(result);
        if (read.data.length < 500) break;
      }
    }
    return json({ ok: true, dry_run: dryRun, archive_only: archiveOnly, retention_days: 60, results });
  } catch (error) {
    console.error('history_archive_failed', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, error: 'archive_failed_no_unverified_deletion' }, 500);
  }
});
