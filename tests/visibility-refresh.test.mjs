import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisibilityRefresh } from '../frontend/src/lib/visibilityRefresh.ts';

function visibility(hidden=false) {
  const listeners=new Set();
  return { hidden,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn),
    change(value) { this.hidden=value; for(const fn of listeners) fn(); },size:()=>listeners.size };
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('100 hidden refreshes become one visible read, then foreground reads remain immediate',async()=>{
  const doc=visibility(true); let reads=0;
  const queue=createVisibilityRefresh(async()=>{ reads++; },doc);
  for(let i=0;i<100;i++) await queue.request();
  assert.equal(reads,0);
  doc.change(false); await flush(); assert.equal(reads,1);
  await queue.request(); assert.equal(reads,2);
  queue.dispose(); assert.equal(doc.size(),0);
});
test('visibility return refreshes after missed events; unmount never reloads',async()=>{
  const doc=visibility(); let reads=0;
  const queue=createVisibilityRefresh(async()=>{ reads++; },doc);
  doc.change(true); doc.change(false); await flush(); assert.equal(reads,1);
  queue.dispose(); doc.change(true); doc.change(false); await queue.request(); assert.equal(reads,1);
});
test('events during in-flight read are deferred if the tab becomes hidden',async()=>{
  const doc=visibility(); let reads=0,release;
  const queue=createVisibilityRefresh(async()=>{ reads++; if(reads===1) await new Promise(r=>{release=r;}); },doc);
  const first=queue.request(); doc.change(true); const queued=queue.request(); release(); await first; await queued;
  assert.equal(reads,1); doc.change(false); await flush(); assert.equal(reads,2); queue.dispose();
});
