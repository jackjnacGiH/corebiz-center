import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "csv-parse/sync";

import {
  FLOWACCOUNT_SHEET,
  getSyncSecret,
  INVENTORY_SHEET,
  PRODUCT_PRICE_GID,
  SPREADSHEET_ID,
} from "@/lib/config";
import {
  getSupabaseAdminClient,
  getSupabasePublicClient,
} from "@/lib/supabase/server";
import type { PriceRule, ProductRecord } from "@/lib/types";

type Row = Record<string, string>;

function clean(value: unknown) {
  if (value == null) return "";
  return String(value).replace(/\u00a0/g, " ").replace(/\r/g, "\n").split(/\s+/).join(" ").trim();
}

function parseNumber(value: unknown) {
  const text = clean(value).replace(/,/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function stableHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function extractGrits(value: string) {
  const matches = [...value.matchAll(/#\s*(\d+)/g)];
  return [...new Set(matches.map((match) => String(Number(match[1]))))];
}

function normalizeProductBase(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/(\d)\s*"/g, "$1นิ้ว")
    .replace(/"/g, "นิ้ว")
    .replace(/(\d)\s*นิ้ว/g, "$1นิ้ว")
    .replace(/#\s*\d+/g, " ")
    .replace(/\b\d{8,}\b/g, " ")
    .replace(/[^0-9a-z\u0e00-\u0e7f]+/g, "");
}

function productBaseDisplay(value: string) {
  return clean(value.replace(/#\s*\d+/g, " "));
}

function money(value: number | null) {
  if (value == null) return "ไม่ระบุราคา";
  return `${value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} บาท`;
}

function stockText(value: number | null, unit: string) {
  if (value == null) return "ไม่ระบุคงเหลือ";
  const amount = Number.isInteger(value) ? String(value) : String(value);
  return `${amount} ${unit}`.trim();
}

function availability(stock: number | null) {
  if (stock == null) return "ไม่ระบุคงเหลือ";
  return stock > 0 ? "มีสินค้า" : "ไม่มีสินค้า/คงเหลือเป็น 0";
}

function parseCsvRows(text: string) {
  return parse(text, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];
}

async function fetchCsv(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": "jnac-admin-chat-sheet-sync" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch CSV ${response.status}`);
  }
  return response.text();
}

async function fetchSheetRows(sheetName: string) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const rows = parseCsvRows(await fetchCsv(url));
  const headers = rows.shift()?.map(clean) ?? [];
  return rows
    .map((row) => {
      const record: Row = {};
      headers.forEach((header, index) => {
        if (!header) return;
        if (header.toLowerCase().includes("image") || header.includes("รูปภาพ")) return;
        record[header] = clean(row[index]);
      });
      return record;
    })
    .filter((row) => Object.values(row).some(Boolean));
}

async function fetchProductPriceRows() {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${PRODUCT_PRICE_GID}`;
  const rows = parseCsvRows(await fetchCsv(url));
  rows.shift();
  return rows
    .map((row, index) => {
      const [productCode, name, unit, detail, price, stock, note] = row;
      return {
        source_row: String(index + 2),
        ProductCode: clean(productCode),
        Name: clean(name),
        Unit: clean(unit),
        Detail: clean(detail),
        ราคา: clean(price),
        คงเหลือ: clean(stock),
        "Note.": clean(note),
      };
    })
    .filter((row) => !["Payment", "Maps"].includes(row.ProductCode))
    .filter((row) => row.Name || row.ราคา);
}

function buildPriceRules(productRows: Row[]) {
  const rules: PriceRule[] = [];
  const rulesByBase = new Map<string, PriceRule[]>();

  productRows.forEach((row, index) => {
    const name = clean(row.Name);
    const price = parseNumber(row.ราคา);
    const baseKey = normalizeProductBase(name);
    if (!name || price == null || !baseKey) return;

    const grits = extractGrits(name);
    const unit = clean(row.Unit);
    const baseName = productBaseDisplay(name);
    const rule: PriceRule = {
      id: `jnac_price_rule_${String(index + 1).padStart(4, "0")}`,
      type: "price_rule",
      source_row: clean(row.source_row),
      source_product_code: clean(row.ProductCode),
      name,
      base_name: baseName,
      base_key: baseKey,
      grits,
      unit,
      price,
      detail: clean(row.Detail),
      note: clean(row["Note."]),
      embedding_text: [
        `รายการราคา: ${baseName}`,
        grits.length ? `เบอร์: ${grits.map((grit) => `#${grit}`).join(" ")}` : "",
        row.Detail ? `รายละเอียด: ${clean(row.Detail)}` : "",
        unit ? `ราคา: ${money(price)} ต่อ${unit}` : `ราคา: ${money(price)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      answer_text:
        `${baseName} ${grits.map((grit) => `#${grit}`).join(" ")} ราคา${unit || "หน่วย"}ละ ${money(price)}`.trim(),
      hash: "",
    };
    rule.hash = stableHash({
      name: rule.name,
      grits: rule.grits,
      unit: rule.unit,
      price: rule.price,
      detail: rule.detail,
      note: rule.note,
    });
    rules.push(rule);
    rulesByBase.set(baseKey, [...(rulesByBase.get(baseKey) ?? []), rule]);
  });

  return { rules, rulesByBase };
}

function resolveProductPrice(name: string, rulesByBase: Map<string, PriceRule[]>) {
  const candidates = rulesByBase.get(normalizeProductBase(name)) ?? [];
  const itemGrits = new Set(extractGrits(name));
  const scored = candidates
    .filter((rule) => {
      if (!itemGrits.size || !rule.grits.length) return true;
      return rule.grits.some((grit) => itemGrits.has(grit));
    })
    .map((rule) => {
      let score = 100;
      const matched = rule.grits.filter((grit) => itemGrits.has(grit));
      if (matched.length) score += 20 + matched.length;
      return { rule, score };
    })
    .sort((a, b) => b.score - a.score);

  const rule = scored[0]?.rule;
  if (!rule) {
    return {
      price: null,
      unit: "",
      source: candidates.length ? "Product:base_match_grit_not_found" : "Product:no_match",
      matchedRuleId: "",
      matchedRuleName: "",
      matchedGrits: [] as string[],
    };
  }

  return {
    price: rule.price,
    unit: rule.unit,
    source: "Product",
    matchedRuleId: rule.id,
    matchedRuleName: rule.name,
    matchedGrits: rule.grits,
  };
}

export async function buildSheetData() {
  const fetchedAt = new Date().toISOString();
  const [inventoryRows, flowRows, productPriceRows] = await Promise.all([
    fetchSheetRows(INVENTORY_SHEET),
    fetchSheetRows(FLOWACCOUNT_SHEET),
    fetchProductPriceRows(),
  ]);
  const { rules, rulesByBase } = buildPriceRules(productPriceRows);

  const inventoryByCode = new Map<string, Row>();
  inventoryRows.forEach((row) => {
    const code = clean(row.Barcode);
    if (code) inventoryByCode.set(code, row);
  });

  const flowByCode = new Map<string, Row>();
  flowRows.forEach((row) => {
    const code = clean(row.ProductCode);
    if (code) flowByCode.set(code, row);
  });

  const allCodes = [...new Set([...inventoryByCode.keys(), ...flowByCode.keys()])].sort();
  const records: ProductRecord[] = allCodes.map((code) => {
    const flow = flowByCode.get(code) ?? {};
    const inv = inventoryByCode.get(code) ?? {};
    const name = clean(flow.Name) || clean(inv.Name);
    const description = clean(flow.Description) || clean(inv.Detail);
    const category = clean(inv.Category);
    const priceMatch = resolveProductPrice(name, rulesByBase);
    const unit = clean(inv.Unit) || priceMatch.unit;
    const price = priceMatch.price;
    const inventoryPrice = parseNumber(inv.Price);
    const stock = parseNumber(inv.Stock);
    const minStock = parseNumber(inv.Min_Stock);
    const shelf = clean(inv.Shelf);
    const row = clean(inv.Row);
    const flowQty = parseNumber(flow.Qty);
    const stablePayload = { product_code: code, name, category, description, unit };
    const livePayload = {
      price,
      price_source: priceMatch.source,
      price_rule_id: priceMatch.matchedRuleId,
      inventory_price: inventoryPrice,
      stock,
      min_stock: minStock,
      shelf,
      row,
      flowaccount_qty: flowQty,
    };
    const embeddingText = [
      `รหัสสินค้า: ${code}`,
      `ชื่อสินค้า: ${name}`,
      category ? `หมวดหมู่: ${category}` : "",
      description ? `รายละเอียด: ${description}` : "",
      unit ? `หน่วย: ${unit}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const answerText = [
      `รหัสสินค้า: ${code}`,
      `ชื่อสินค้า: ${name}`,
      description ? `รายละเอียด: ${description}` : "",
      `ราคา: ${money(price)}`,
      `คงเหลือ: ${stockText(stock, unit)}`,
      unit ? `หน่วย: ${unit}` : "",
      shelf || row ? `ตำแหน่งจัดเก็บ: Shelf ${shelf}, Row ${row}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      id: `jnac_product_${code}`,
      type: "product",
      product_code: code,
      name,
      category,
      description,
      unit,
      price,
      inventory_price: inventoryPrice,
      price_source: priceMatch.source,
      price_rule_id: priceMatch.matchedRuleId,
      price_rule_name: priceMatch.matchedRuleName,
      price_rule_grits: priceMatch.matchedGrits,
      stock,
      min_stock: minStock,
      availability: availability(stock),
      shelf,
      row,
      flowaccount_qty: flowQty,
      embedding_text: embeddingText,
      answer_text: answerText,
      hashes: {
        embedding_hash: stableHash(stablePayload),
        live_hash: stableHash(livePayload),
        row_hash: stableHash({ stable: stablePayload, live: livePayload }),
      },
    };
  });

  const priceMatched = records.filter((record) => record.price_source === "Product").length;
  return {
    fetchedAt,
    records,
    priceRules: rules,
    summary: {
      fetched_at: fetchedAt,
      inventory_rows: inventoryRows.length,
      flowaccount_rows: flowRows.length,
      product_price_rows: productPriceRows.length,
      product_price_rules: rules.length,
      output_records: records.length,
      price_matched_records: priceMatched,
      price_unmatched_records: records.length - priceMatched,
      inventory_only_codes: [...inventoryByCode.keys()].filter((code) => !flowByCode.has(code))
        .length,
      flowaccount_only_codes: [...flowByCode.keys()].filter((code) => !inventoryByCode.has(code))
        .length,
    },
  };
}

function productToDb(record: ProductRecord) {
  return {
    product_code: record.product_code,
    name: record.name,
    category: record.category,
    description: record.description,
    unit: record.unit,
    price: record.price,
    inventory_price: record.inventory_price,
    price_source: record.price_source,
    price_rule_id: record.price_rule_id || null,
    price_rule_name: record.price_rule_name,
    price_rule_grits: record.price_rule_grits,
    stock: record.stock,
    min_stock: record.min_stock,
    availability: record.availability,
    shelf: record.shelf,
    row: record.row,
    flowaccount_qty: record.flowaccount_qty,
    embedding_text: record.embedding_text,
    answer_text: record.answer_text,
    embedding_hash: record.hashes?.embedding_hash,
    live_hash: record.hashes?.live_hash,
    row_hash: record.hashes?.row_hash,
    raw: record,
    updated_at: new Date().toISOString(),
  };
}

function priceRuleToDb(rule: PriceRule) {
  return {
    id: rule.id,
    source_row: rule.source_row,
    source_product_code: rule.source_product_code,
    name: rule.name,
    base_name: rule.base_name,
    base_key: rule.base_key,
    grits: rule.grits,
    unit: rule.unit,
    price: rule.price,
    detail: rule.detail,
    note: rule.note,
    embedding_text: rule.embedding_text,
    answer_text: rule.answer_text,
    rule_hash: rule.hash,
    raw: rule,
    updated_at: new Date().toISOString(),
  };
}

async function upsertChunks(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
) {
  const supabase = getSupabaseAdminClient();
  if (!supabase || !rows.length) return;

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from(table)
      .upsert(chunk as unknown as never[], { onConflict });
    if (error) throw error;
  }
}

async function syncViaRpc(
  products: Record<string, unknown>[],
  priceRules: Record<string, unknown>[],
  summary: Record<string, unknown>,
) {
  const supabase = getSupabasePublicClient();
  if (!supabase) return null;

  const sync_secret = getSyncSecret();
  if (!sync_secret) return null;
  const totals = {
    changed_rows: 0,
    changed_embedding_rows: 0,
    changed_live_rows: 0,
  };

  const syncChunk = async (
    productChunk: Record<string, unknown>[],
    priceRuleChunk: Record<string, unknown>[],
  ) => {
    const { data, error } = await supabase.rpc("sync_jnac_data", {
      products: productChunk,
      price_rules: priceRuleChunk,
      run_summary: summary,
      sync_secret,
    });
    if (error) throw error;
    const chunkSummary = data as Record<string, unknown>;
    totals.changed_rows += Number(chunkSummary.changed_rows ?? 0);
    totals.changed_embedding_rows += Number(chunkSummary.changed_embedding_rows ?? 0);
    totals.changed_live_rows += Number(chunkSummary.changed_live_rows ?? 0);
  };

  await syncChunk([], priceRules);
  for (let i = 0; i < products.length; i += 400) {
    await syncChunk(products.slice(i, i + 400), []);
  }

  const finalSummary = { ...summary, ...totals };
  const { error } = await supabase.rpc("record_jnac_sync", {
    run_summary: finalSummary,
    sync_secret,
  });
  if (error) throw error;
  return finalSummary;
}

export async function syncSheetsToStorage() {
  const supabase = getSupabaseAdminClient();
  const data = await buildSheetData();

  if (supabase) {
    const { data: oldRows, error: oldError } = await supabase
      .from("products_current")
      .select("product_code,row_hash,embedding_hash,live_hash");
    if (oldError) throw oldError;
    const oldByCode = new Map(
      (oldRows ?? []).map((row) => [
        row.product_code as string,
        {
          row_hash: row.row_hash as string | null,
          embedding_hash: row.embedding_hash as string | null,
          live_hash: row.live_hash as string | null,
        },
      ]),
    );
    const changedRows = data.records.filter(
      (record) => oldByCode.get(record.product_code)?.row_hash !== record.hashes?.row_hash,
    );
    const changedEmbeddingRows = data.records.filter(
      (record) =>
        oldByCode.get(record.product_code)?.embedding_hash !== record.hashes?.embedding_hash,
    );
    const changedLiveRows = data.records.filter(
      (record) => oldByCode.get(record.product_code)?.live_hash !== record.hashes?.live_hash,
    );

    await upsertChunks("product_price_rules", data.priceRules.map(priceRuleToDb), "id");
    await upsertChunks("products_current", data.records.map(productToDb), "product_code");

    const summary = {
      ...data.summary,
      changed_rows: changedRows.length,
      changed_embedding_rows: changedEmbeddingRows.length,
      changed_live_rows: changedLiveRows.length,
    };
    await supabase.from("sync_runs").insert({ status: "success", summary });
    return summary;
  }

  const rpcSummary = await syncViaRpc(
    data.records.map(productToDb),
    data.priceRules.map(priceRuleToDb),
    data.summary,
  );
  if (rpcSummary) return rpcSummary;

  const outputDir = path.resolve(process.cwd(), "data");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "jnac_admin_products.jsonl"),
    data.records.map((record) => JSON.stringify(record)).join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "jnac_product_price_rules.jsonl"),
    data.priceRules.map((rule) => JSON.stringify(rule)).join("\n"),
    "utf8",
  );
  const summary = {
    ...data.summary,
    changed_rows: data.records.length,
    changed_embedding_rows: data.records.length,
    changed_live_rows: data.records.length,
  };
  await writeFile(path.join(outputDir, "sync-summary.json"), JSON.stringify(summary, null, 2));
  return summary;
}
