const REQUIRED_HEADERS = [
  "tracking_code",
  "ค่าขนส่ง",
  "ค่าพื้นที่ห่างไกล",
  "fee_cod",
  "fee_vat",
] as const;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5_000;
const MAX_AMOUNT = 10_000_000;

export interface PromptSpeedBillingRow {
  tracking_code: string;
  shipping_amount: number;
  remote_area_fee: number;
  cod_fee: number;
  fee_vat: number;
  billed_amount: number;
}

export interface PromptSpeedBillingFile {
  file_name: string;
  file_sha256: string;
  sheet_name: string;
  rows: PromptSpeedBillingRow[];
  duplicate_rows: number;
  duplicate_tracking_codes: string[];
  total_amount: number;
}

export class ShippingBillingFileError extends Error {
  tracking_codes: string[];

  constructor(code: string, trackingCodes: string[] = []) {
    super(code);
    this.name = "ShippingBillingFileError";
    this.tracking_codes = trackingCodes;
  }
}

const fail = (code: string, trackingCodes: string[] = []): never => {
  throw new ShippingBillingFileError(code, trackingCodes);
};

const decodeXml = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#([0-9]+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

const attr = (source: string, name: string) => {
  const match = source.match(new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : "";
};

const tagText = (source: string, tag: string) => {
  const values = [...source.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"))];
  return values.map((match) => decodeXml(match[1].replace(/<[^>]+>/g, ""))).join("");
};

const columnIndex = (reference: string) => {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return -1;
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
};

const normalizeHeader = (value: string) => value.trim().toLocaleLowerCase("en-US");

const amount = (value: string) => {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_AMOUNT) fail("billing_invalid_amount");
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
};

const addMoney = (...values: number[]) =>
  Math.round((values.reduce((sum, value) => sum + value, 0) + Number.EPSILON) * 100) / 100;

const parseSharedStrings = (xml: string) =>
  [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)]
    .map((match) => tagText(match[1], "t"));

const parseRows = (xml: string, sharedStrings: string[]) =>
  [...xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/gi)].map((rowMatch) => {
    const row = new Map<number, string>();
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const index = columnIndex(attr(cellMatch[1], "r"));
      if (index < 0) continue;
      const type = attr(cellMatch[1], "t");
      const contents = cellMatch[2] ?? "";
      const raw = type === "inlineStr" ? tagText(contents, "t") : tagText(contents, "v");
      row.set(index, type === "s" ? sharedStrings[Number(raw)] ?? "" : raw);
    }
    return row;
  });

const workbookSheets = (workbookXml: string, relationshipsXml: string) => {
  const targets = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship([^>]*)\/?>(?:<\/Relationship>)?/gi)) {
    const id = attr(match[1], "Id");
    const target = attr(match[1], "Target");
    if (id && target) {
      const resolved = new URL(target, "https://workbook.local/xl/workbook.xml");
      targets.set(id, resolved.pathname.replace(/^\//, ""));
    }
  }
  const sheets: { name: string; path: string }[] = [];
  for (const match of workbookXml.matchAll(/<sheet([^>]*)\/?>(?:<\/sheet>)?/gi)) {
    const name = attr(match[1], "name");
    const path = targets.get(attr(match[1], "r:id"));
    if (name && path) sheets.push({ name, path });
  }
  return sheets;
};

const fileHash = async (bytes: ArrayBuffer) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
};

export async function parsePromptSpeedBillingFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
): Promise<PromptSpeedBillingFile> {
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".xlsx")) fail("billing_invalid_file_type");
  if (!file.size || file.size > MAX_FILE_BYTES) fail("billing_invalid_file_size");
  const bytes = await file.arrayBuffer();
  const [{ default: JSZip }, sha256] = await Promise.all([
    import("jszip"),
    fileHash(bytes),
  ]);
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return fail("billing_invalid_workbook");
  }
  const workbookEntry = zip.file("xl/workbook.xml");
  const relationshipsEntry = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relationshipsEntry) fail("billing_invalid_workbook");
  const [workbookXml, relationshipsXml, sharedStringsXml] = await Promise.all([
    workbookEntry!.async("string"),
    relationshipsEntry!.async("string"),
    zip.file("xl/sharedStrings.xml")?.async("string") ?? Promise.resolve(""),
  ]);
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const sheets = workbookSheets(workbookXml, relationshipsXml);
  for (const sheet of sheets) {
    const entry = zip.file(sheet.path);
    if (!entry) continue;
    const rows = parseRows(await entry.async("string"), sharedStrings);
    const headerRow = rows.findIndex((row) => {
      const headers = new Set([...row.values()].map(normalizeHeader));
      return REQUIRED_HEADERS.every((header) => headers.has(header));
    });
    if (headerRow < 0) continue;
    const headerIndexes = new Map<string, number>();
    for (const [index, value] of rows[headerRow]) headerIndexes.set(normalizeHeader(value), index);
    const read = (row: Map<number, string>, header: typeof REQUIRED_HEADERS[number]) =>
      row.get(headerIndexes.get(header) ?? -1) ?? "";
    const found = new Map<string, PromptSpeedBillingRow>();
    const duplicateTrackingCodes = new Set<string>();
    let duplicateRows = 0;
    for (const row of rows.slice(headerRow + 1)) {
      const trackingCode = read(row, "tracking_code").trim().toUpperCase();
      if (!trackingCode) continue;
      if (!/^[A-Z0-9-]{5,80}$/.test(trackingCode)) fail("billing_invalid_tracking");
      const shippingAmount = amount(read(row, "ค่าขนส่ง"));
      const remoteAreaFee = amount(read(row, "ค่าพื้นที่ห่างไกล"));
      const codFee = amount(read(row, "fee_cod"));
      const feeVat = amount(read(row, "fee_vat"));
      const parsed: PromptSpeedBillingRow = {
        tracking_code: trackingCode,
        shipping_amount: shippingAmount,
        remote_area_fee: remoteAreaFee,
        cod_fee: codFee,
        fee_vat: feeVat,
        billed_amount: addMoney(shippingAmount, remoteAreaFee, codFee, feeVat),
      };
      const previous = found.get(trackingCode);
      if (previous) {
        duplicateRows += 1;
        duplicateTrackingCodes.add(trackingCode);
        if (JSON.stringify(previous) !== JSON.stringify(parsed)) {
          fail("billing_duplicate_conflict", [trackingCode]);
        }
        continue;
      }
      found.set(trackingCode, parsed);
      if (found.size > MAX_ROWS) fail("billing_too_many_rows");
    }
    if (!found.size) fail("billing_no_rows");
    const billingRows = [...found.values()];
    return {
      file_name: file.name.slice(0, 255),
      file_sha256: sha256,
      sheet_name: sheet.name.slice(0, 150),
      rows: billingRows,
      duplicate_rows: duplicateRows,
      duplicate_tracking_codes: [...duplicateTrackingCodes].sort(),
      total_amount: addMoney(...billingRows.map((row) => row.billed_amount)),
    };
  }
  return fail("billing_missing_columns");
}
