import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Button } from './ui/button';

type Preview = { digest: string; preview: { legal_name: string; registered_address: string; bank_accounts: { bank_name: string; account_type: string; account_name: string; account_number: string }[] } };
type Receipt = { approved_by: string; approved_at: string; valid_until: string };

// Uses the existing owner's session. Never accepts or copies credentials,
// source values or an approval identity from a form.
export default function CriticalCompanyBinding() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function request(bind: boolean) {
    setBusy(true); setError('');
    try {
      const { data, error: previewError } = await supabase.functions.invoke('critical-company-approval', { body: { action: 'preview' } });
      if (previewError || !data?.digest || !data?.preview) throw new Error();
      setPreview(data);
      if (!bind) return;
      const result = await supabase.functions.invoke('critical-company-approval', { body: { action: 'bind', digest: data.digest } });
      if (result.error || result.data?.state !== 'bound' || !result.data.approval?.approved_by || !result.data.approval?.approved_at || !result.data.approval?.valid_until) throw new Error();
      setReceipt(result.data.approval);
    } catch {
      setReceipt(null);
      setError(bind ? 'ยังยืนยันผลการเชื่อมข้อมูลไม่ได้ กรุณาตรวจสถานะก่อนลองใหม่' : 'อ่านข้อมูลต้นทางไม่ได้ กรุณาตรวจสอบกับเจ้าหน้าที่');
    } finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-neutral-200 bg-white p-6 space-y-3" aria-labelledby="critical-company-title">
    <h2 id="critical-company-title" className="font-semibold">ข้อมูลบริษัทและบัญชีสำหรับ OmniChat</h2>
    <p className="text-sm text-neutral-600">ใช้ข้อมูลที่เจ้าของยืนยันแล้วจาก Knowledge Base และ Workspace โดยไม่ต้องกรอกใหม่ หากต้นทางเปลี่ยน ระบบจะส่งให้เจ้าหน้าที่ตรวจสอบ</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void request(false)}>แสดงข้อมูลต้นทาง</Button>
      <Button disabled={busy} onClick={() => void request(true)}>{busy ? 'กำลังตรวจสอบ...' : 'เชื่อมข้อมูลที่ยืนยันแล้ว'}</Button>
    </div>
    {preview && <div className="text-sm whitespace-pre-wrap space-y-2">
      <p>{preview.preview.legal_name}{'\n'}{preview.preview.registered_address}</p>
      {preview.preview.bank_accounts.map((bank, index) => <p key={index}>{bank.bank_name}{'\n'}{bank.account_type}{'\n'}{bank.account_name}{'\n'}{bank.account_number}</p>)}
    </div>}
    {receipt && <p role="status" className="text-sm text-emerald-700">บันทึกการเชื่อมข้อมูลต้นทางแล้ว เวลา {receipt.approved_at} ใช้ได้ถึง {receipt.valid_until}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
