import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  parsePromptSpeedBillingFile,
  ShippingBillingFileError,
} from "../frontend/src/lib/shipping-billing.ts";

const xml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

async function workbookFile(headers, rows) {
  const strings = [...headers];
  for (const row of rows) for (const value of row)
    if (typeof value === "string" && !strings.includes(value)) strings.push(value);
  const index = new Map(strings.map((value, i) => [value, i]));
  const columns = headers.map((_value, i) => String.fromCharCode(65 + i));
  const sheetRows = [headers, ...rows].map((row, rowIndex) => {
    const cells = row.map((value, column) => {
      const reference = `${columns[column]}${rowIndex + 1}`;
      if (value === null) return `<c r="${reference}" s="1"/>`;
      if (typeof value === "string")
        return `<c r="${reference}" t="s"><v>${index.get(value)}</v></c>`;
      return `<c r="${reference}"><v>${value}</v></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const zip = new JSZip();
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook><sheets><sheet name="รายละเอียดวางบิล" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst>${strings.map((value) => `<si><t>${xml(value)}</t></si>`).join("")}</sst>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`);
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return {
    name: "promptspeed.xlsx",
    size: bytes.byteLength,
    arrayBuffer: async () => bytes,
  };
}

const headers = [
  "tracking_code",
  "ค่าขนส่ง",
  "ค่าพื้นที่ห่างไกล",
  "Fee_COD",
  "Fee_Vat",
];

test("PromptSpeed workbook parser calculates the billed total and removes exact duplicate tracking rows", async () => {
  const file = await workbookFile(["unused", ...headers], [
    [null, "TH011396TFB46F", 32, 0, 0, 0],
    [null, "TH370196TEBB0O", 98, 10, 3, 0.21],
    [null, "TH011396TFB46F", 32, 0, 0, 0],
  ]);
  const result = await parsePromptSpeedBillingFile(file);
  assert.equal(result.sheet_name, "รายละเอียดวางบิล");
  assert.equal(result.rows.length, 2);
  assert.equal(result.duplicate_rows, 1);
  assert.deepEqual(result.duplicate_tracking_codes, ["TH011396TFB46F"]);
  assert.equal(result.rows[1].billed_amount, 111.21);
  assert.equal(result.total_amount, 143.21);
  assert.match(result.file_sha256, /^[0-9a-f]{64}$/);
});

test("PromptSpeed workbook parser rejects missing financial columns and conflicting duplicates", async () => {
  const missing = await workbookFile(headers.slice(0, 4), [["TH011396TFB46F", 32, 0, 0]]);
  await assert.rejects(() => parsePromptSpeedBillingFile(missing), /billing_missing_columns/);

  const conflicting = await workbookFile(headers, [
    ["TH011396TFB46F", 32, 0, 0, 0],
    ["TH011396TFB46F", 35, 0, 0, 0],
  ]);
  await assert.rejects(
    () => parsePromptSpeedBillingFile(conflicting),
    error => error instanceof ShippingBillingFileError &&
      error.message === "billing_duplicate_conflict" &&
      error.tracking_codes[0] === "TH011396TFB46F",
  );
});
