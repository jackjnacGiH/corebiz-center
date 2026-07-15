/**
 * Pull stock from the public Google Sheet into the default warehouse.
 *
 * Important: unchanged rows are not written. Writing last_synced_at for every
 * product caused hundreds of Realtime events every 15 minutes and forced the
 * admin SPA to reload large product/customer datasets.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.2";

const SHEET_ID = "1c3U81eazLDTMQTdDScObASikKgYJf_qmKabn4Lyf1Og";
const SHEET_GID = "1318634616";
const SHEET_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

interface SheetRow {
  sku: string;
  stock: string;
}

interface InventoryRow {
  id: string;
  product_id: string;
  quantity: number | string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** RFC-4180 CSV parser with quoted-field and CRLF support. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      current.push(field);
      field = "";
    } else if (ch === "\n") {
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  const syncSecret = Deno.env.get("INVENTORY_SYNC_SECRET");
  if (!syncSecret) {
    console.error("INVENTORY_SYNC_SECRET is not configured");
    return json({ ok: false, error: "sync_not_configured" }, 503);
  }

  const providedSecret = req.headers.get("x-sync-secret");
  if (!providedSecret || providedSecret !== syncSecret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const startedAt = new Date();
  const sourceParam = new URL(req.url).searchParams.get("source");
  const source = sourceParam === "cron" || sourceParam === "webhook"
    ? sourceParam
    : "manual";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("Supabase runtime secrets are not configured");
    return json({ ok: false, error: "runtime_not_configured" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let logId: string | null = null;
  const { data: log, error: logError } = await admin
    .from("inventory_sync_logs")
    .insert({ source, status: "pending", started_at: startedAt.toISOString() })
    .select("id")
    .single();
  if (logError) console.error("sync_log insert failed:", logError);
  else logId = log.id as string;

  try {
    const sheetResponse = await fetch(SHEET_CSV_URL, { redirect: "follow" });
    if (!sheetResponse.ok) {
      throw new Error(
        `Sheet fetch failed: ${sheetResponse.status} ${sheetResponse.statusText}`,
      );
    }

    const allRows = parseCsv(await sheetResponse.text());
    if (allRows.length < 2) throw new Error("Sheet has no data rows");

    const header = allRows[0].map((value) => value.trim().toLowerCase());
    const barcodeIndex = header.indexOf("barcode");
    const stockIndex = header.indexOf("stock");
    if (barcodeIndex === -1 || stockIndex === -1) {
      throw new Error(`Required columns missing. Header: ${allRows[0].join(", ")}`);
    }

    const sheetData: SheetRow[] = allRows.slice(1)
      .map((row) => ({
        sku: (row[barcodeIndex] ?? "").trim(),
        stock: (row[stockIndex] ?? "").trim(),
      }))
      .filter((row) => row.sku);

    const skuToProductId = new Map<string, string>();
    const pageSize = 1000;
    for (let from = 0;; from += pageSize) {
      const { data, error } = await admin
        .from("products")
        .select("id, sku")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data?.length) break;
      for (const product of data) {
        if (product.sku) skuToProductId.set(product.sku as string, product.id as string);
      }
      if (data.length < pageSize) break;
    }

    const { data: defaultWarehouse, error: warehouseError } = await admin
      .from("warehouses")
      .select("id, name")
      .eq("is_default", true)
      .limit(1)
      .maybeSingle();
    if (warehouseError) throw warehouseError;
    if (!defaultWarehouse) {
      throw new Error("No default warehouse configured (warehouses.is_default = true)");
    }
    const warehouseId = defaultWarehouse.id as string;

    // One paginated read replaces roughly 500 per-row inventory lookups.
    const inventoryByProduct = new Map<string, InventoryRow>();
    for (let from = 0;; from += pageSize) {
      const { data, error } = await admin
        .from("inventory")
        .select("id, product_id, quantity")
        .eq("warehouse_id", warehouseId)
        .is("variant_id", null)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data?.length) break;
      for (const row of data as InventoryRow[]) {
        inventoryByProduct.set(row.product_id, row);
      }
      if (data.length < pageSize) break;
    }

    const syncedAt = new Date().toISOString();
    let matched = 0;
    let updated = 0;
    let skipped = 0;
    const unmatched: string[] = [];

    for (const row of sheetData) {
      const productId = skuToProductId.get(row.sku);
      if (!productId) {
        skipped++;
        if (unmatched.length < 20) unmatched.push(row.sku);
        continue;
      }
      matched++;

      if (!row.stock) {
        skipped++;
        continue;
      }
      const quantity = Number.parseFloat(row.stock.replace(/,/g, ""));
      if (!Number.isFinite(quantity) || quantity < 0) {
        skipped++;
        continue;
      }

      const existing = inventoryByProduct.get(productId);
      if (existing && Number(existing.quantity) === quantity) {
        continue;
      }

      if (existing) {
        const { error } = await admin
          .from("inventory")
          .update({ quantity, last_synced_at: syncedAt })
          .eq("id", existing.id);
        if (error) {
          console.error(`update failed for ${row.sku}:`, error);
          continue;
        }
      } else {
        const { error } = await admin.from("inventory").insert({
          product_id: productId,
          warehouse_id: warehouseId,
          quantity,
          last_synced_at: syncedAt,
        });
        if (error) {
          console.error(`insert failed for ${row.sku}:`, error);
          continue;
        }
      }
      updated++;
    }

    if (logId) {
      const { error } = await admin.from("inventory_sync_logs").update({
        finished_at: new Date().toISOString(),
        status: "success",
        sheet_rows: sheetData.length,
        matched,
        updated,
        skipped,
        details: { warehouse_id: warehouseId, unmatched_sample: unmatched },
      }).eq("id", logId);
      if (error) console.error("sync_log finalize failed:", error);
    }

    return json({
      ok: true,
      sheet_rows: sheetData.length,
      matched,
      updated,
      skipped,
      warehouse: defaultWarehouse.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("sync error:", message);
    if (logId) {
      const { error: logUpdateError } = await admin
        .from("inventory_sync_logs")
        .update({
          finished_at: new Date().toISOString(),
          status: "error",
          error: message,
        })
        .eq("id", logId);
      if (logUpdateError) console.error("sync_log error finalize failed:", logUpdateError);
    }
    return json({ ok: false, error: message }, 500);
  }
});
