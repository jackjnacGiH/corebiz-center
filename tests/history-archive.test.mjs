import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { archiveVerifiedBatch, sha256 } from '../supabase/functions/_shared/history-archive.ts';

test('backup is lossless and downloaded/verified before pruning',async()=>{
  const rows=[{id:'example',details:{thai:'ตรวจสอบประวัติ'}}];
  const events=[],objects=new Map();
  const result=await archiveVerifiedBatch({source:'inventory',cutoff:'2026-08-01T00:00:00Z',rows,
    upload:async(path,bytes)=>{ events.push('upload'); objects.set(path,bytes); },
    download:async(path)=>{ events.push('download'); return objects.get(path); },
    commit:async(a)=>{ events.push('prune'); assert.equal(await sha256(objects.get(a.objectPath)),a.sha256); assert.deepEqual(JSON.parse(gunzipSync(objects.get(a.objectPath)).toString()),rows); return 'verified'; },
  });
  assert.equal(result,'verified'); assert.deepEqual(events,['upload','download','prune']);
});
for(const stage of ['upload','download','checksum']) test(`${stage} failure never prunes history`,async()=>{
  let deletes=0;
  await assert.rejects(archiveVerifiedBatch({source:'cron',cutoff:'2026-08-01',rows:[{runid:1}],
    upload:async()=>{ if(stage==='upload') throw Error('upload failure'); },
    download:async()=>{ if(stage==='download') throw Error('download failure'); return new Uint8Array([0]); },
    commit:async()=>{ deletes++; },
  }));
  assert.equal(deletes,0);
});
