"use client";

import { useEffect, useState } from "react";

/**
 * Structured Thai address input: a free "เลขที่/หมู่/ซอย/ถนน" line plus a
 * 5-digit postal code that auto-fills ตำบล/อำเภอ/จังหวัด (แขวง/เขต for
 * Bangkok). Data: /th-address.json — a zip → [tambon, amphoe, province][]
 * index built from the open-source kongvut/thai-province-data set, fetched
 * lazily on first use and cached for the page.
 *
 * Emits the composed single-line address via onChange, e.g.
 * "84 หมู่ 2 ซ.สุนทรวิภาค ต.แพรกษาใหม่ อ.เมืองสมุทรปราการ จ.สมุทรปราการ 10280".
 * A manual free-text mode stays available (and is the default when editing an
 * existing address, which can't be reliably split back into parts).
 */

type ZipEntry = [string, string, string]; // [tambon, amphoe, province]
type ZipIndex = Record<string, ZipEntry[]>;

let zipIndexPromise: Promise<ZipIndex> | null = null;
function loadZipIndex(): Promise<ZipIndex> {
  if (!zipIndexPromise) {
    zipIndexPromise = fetch("/th-address.json")
      .then((r) => (r.ok ? (r.json() as Promise<ZipIndex>) : {}))
      .catch(() => ({}) as ZipIndex);
  }
  return zipIndexPromise;
}

function compose(line: string, entry: ZipEntry | null, zip: string): string {
  const parts: string[] = [];
  if (line.trim()) parts.push(line.trim());
  if (entry) {
    const [t, a, p] = entry;
    if (p === "กรุงเทพมหานคร") parts.push(`แขวง${t}`, `เขต${a}`, p);
    else parts.push(`ต.${t}`, `อ.${a}`, `จ.${p}`);
  }
  if (zip.length === 5) parts.push(zip);
  return parts.join(" ");
}

const field =
  "w-full rounded-lg border border-neutral-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400";

export default function ThaiAddressInput({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  // Existing text can't be split back into parts → start in manual mode.
  const [manual, setManual] = useState(() => !!value.trim());
  const [line, setLine] = useState("");
  const [zip, setZip] = useState("");
  const [options, setOptions] = useState<ZipEntry[]>([]);
  const [sel, setSel] = useState(-1);
  const [zipMiss, setZipMiss] = useState(false);

  // Look up the zip once 5 digits are typed.
  useEffect(() => {
    if (manual) return;
    const digits = zip.replace(/\D/g, "");
    if (digits.length !== 5) {
      setOptions([]);
      setSel(-1);
      setZipMiss(false);
      return;
    }
    let live = true;
    void loadZipIndex().then((idx) => {
      if (!live) return;
      const found = idx[digits] ?? [];
      setOptions(found);
      setSel(found.length === 1 ? 0 : -1);
      setZipMiss(found.length === 0);
    });
    return () => { live = false; };
  }, [zip, manual]);

  // Push the composed address up whenever structured parts change.
  useEffect(() => {
    if (manual) return;
    onChange(compose(line, sel >= 0 ? options[sel] : null, zip.replace(/\D/g, "")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, zip, sel, options, manual]);

  if (manual) {
    return (
      <div>
        <textarea
          className={field}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="เลขที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด รหัสไปรษณีย์"
          required={required}
        />
        <button
          type="button"
          onClick={() => { setManual(false); onChange(compose(line, sel >= 0 ? options[sel] : null, zip)); }}
          className="mt-1 text-[11px] text-sky-600 underline underline-offset-2"
        >
          ใช้ตัวช่วยกรอก (ใส่รหัสไปรษณีย์ → ได้ตำบล/อำเภอ/จังหวัดอัตโนมัติ)
        </button>
      </div>
    );
  }

  const entry = sel >= 0 ? options[sel] : null;

  return (
    <div className="space-y-2">
      <input
        className={field}
        value={line}
        onChange={(e) => setLine(e.target.value)}
        placeholder="เลขที่ หมู่ ซอย ถนน อาคาร เช่น 84 หมู่ 2 ซ.สุนทรวิภาค"
        required={required}
      />
      <div className="grid grid-cols-[8.5rem_1fr] gap-2">
        <input
          className={field}
          inputMode="numeric"
          maxLength={5}
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="รหัสไปรษณีย์"
          required={required}
        />
        {options.length > 0 ? (
          <select
            className={field}
            value={sel}
            onChange={(e) => setSel(Number(e.target.value))}
          >
            <option value={-1} disabled>— เลือกตำบล/แขวง —</option>
            {options.map((o, i) => (
              <option key={i} value={i}>
                {o[2] === "กรุงเทพมหานคร" ? `แขวง${o[0]} เขต${o[1]}` : `ต.${o[0]} อ.${o[1]}`}
              </option>
            ))}
          </select>
        ) : (
          <div className={`${field} bg-neutral-50 text-neutral-400 select-none`}>
            {zipMiss ? "ไม่พบรหัสไปรษณีย์นี้" : "ตำบล/อำเภอ จะแสดงเมื่อใส่รหัสไปรษณีย์"}
          </div>
        )}
      </div>
      {entry && (
        <p className="text-[11px] text-emerald-700">
          ✓ {entry[2] === "กรุงเทพมหานคร"
            ? `แขวง${entry[0]} เขต${entry[1]} กรุงเทพมหานคร`
            : `ต.${entry[0]} อ.${entry[1]} จ.${entry[2]}`} {zip}
        </p>
      )}
      <button
        type="button"
        onClick={() => setManual(true)}
        className="text-[11px] text-neutral-400 underline underline-offset-2"
      >
        พิมพ์ที่อยู่เองทั้งหมด
      </button>
    </div>
  );
}
