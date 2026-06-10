import { Printer } from 'lucide-react';
import { printElement } from '../lib/print';

/**
 * Compact print control for documents: lets the operator print the ต้นฉบับ
 * (original), สำเนา (copy), or both (2 pages). Prints #printable-doc via an
 * isolated popup (see lib/print.ts) and stamps the chosen label on the copy.
 */
export default function PrintMenu({
  title = 'เอกสาร',
  targetId = 'printable-doc',
  className = '',
}: {
  title?: string;
  targetId?: string;
  className?: string;
}) {
  const go = (copies: string[]) => printElement(targetId, { title, copies });
  const pill =
    'h-8 px-2.5 rounded-md border border-indigo-200 text-indigo-700 text-xs font-semibold hover:bg-indigo-50 transition';

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
        <Printer size={14} /> พิมพ์:
      </span>
      <button type="button" onClick={() => go(['ต้นฉบับ'])} className={pill}>ต้นฉบับ</button>
      <button type="button" onClick={() => go(['สำเนา'])} className={pill}>สำเนา</button>
      <button type="button" onClick={() => go(['ต้นฉบับ', 'สำเนา'])} className={pill}>ทั้งคู่</button>
    </div>
  );
}
