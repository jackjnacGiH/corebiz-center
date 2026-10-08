import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

// Repeatable synthetic payload baseline: no customer data, network or DB writes.
const api = readFileSync(new URL('../frontend/src/lib/api.ts', import.meta.url), 'utf8');
const listMethod = api.slice(api.indexOf('async listConversations('), api.indexOf('/** One cursor-paginated message page'));
if (!listMethod.includes(".select('conversation_id,company:address->>company')") || !listMethod.includes(".eq('note_type', 'tax_invoice')")) throw new Error('Measured projection does not match current API');
const rooms = 100;
const notes = Array.from({ length: rooms * 4 }, (_, index) => ({
  id: `note-${index}`, conversation_id: `room-${Math.floor(index / 4)}`, note_type: index % 4 === 0 ? 'tax_invoice' : 'note',
  title: 'ข้อมูลสำหรับทดสอบ', content: 'รายละเอียดตัวอย่างสำหรับตรวจขนาดข้อมูล '.repeat(40),
  address: { company: `Factory ${Math.floor(index / 4)}`, line1: '84 หมู่ 2', city: 'สมุทรปราการ', postcode: '10280', tax_id: '0000000000000' },
  sort_order: index % 4, created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z', created_by: 'fixture',
}));
const companyRows = notes.filter(row => row.note_type === 'tax_invoice').map(row => ({ conversation_id: row.conversation_id, company: row.address.company }));
const selectedNotes = notes.filter(row => row.conversation_id === 'room-0');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const before = bytes(notes) + bytes(selectedNotes), after = bytes(companyRows) + bytes(selectedNotes);
const output = {
  fixture: { rooms, notesPerRoom: 4, synthetic: true },
  baseline: { bulkNotePayloadBytes: bytes(notes), selectedNotePayloadBytes: bytes(selectedNotes), combinedBytes: before, enrichmentRequests: 1, selectedNoteRequestsCold: 1 },
  improved: { companyPayloadBytes: bytes(companyRows), selectedNotePayloadBytes: bytes(selectedNotes), combinedBytes: after, enrichmentRequests: 1, selectedNoteRequestsCold: 1, selectedNoteRequestsWarmRender: 0, backgroundRevalidationRequestsPerVisit: 1 },
  reductionPercent: Number(((before - after) / before * 100).toFixed(2)),
  measuredAt: '2026-10-08',
  limit: 'Payload projection comparison only; no production network latency or room-switch p50/p95 claim. Selected notes render from existing per-room cache on revisit and revalidate in background.',
};
// Check identical fixture serialization work before/after, separately from bytes.
for (const [label, fixture] of [['baseline', notes], ['improved', [...companyRows, ...selectedNotes]]]) {
  const start = performance.now();
  for (let index = 0; index < 50; index += 1) JSON.stringify(fixture);
  output[label].fixtureSerializeMs50Runs = Number((performance.now() - start).toFixed(3));
}
console.log(JSON.stringify(output, null, 2));
