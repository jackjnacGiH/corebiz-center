import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { quoteItemsShippingLast } from "../apps/storefront/lib/quote-items.ts";

const compiled = ts.transpileModule(
  readFileSync(new URL("../supabase/functions/storefront-quote/index.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function storefront({ shippingError = false } = {}) {
  const tables = {
    products: [{
      id: "product-1", sku: "2020002623", name_th: "สินค้าทดสอบ", unit: "ชิ้น",
      price: 1200, discount_value: 0, discount_type: "amount", status: "active",
    }],
    quotes: [],
    quote_items: [],
  };
  const events = [];

  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select() { return this; }
    in(column, values) { this.filters.push(["in", column, values]); return this; }
    eq(column, value) { this.filters.push(["eq", column, value]); return this; }
    insert(values) { this.insertRows = Array.isArray(values) ? values : [values]; return this; }
    delete() { this.deleting = true; return this; }
    single() { this.one = true; return this; }
    execute() {
      if (this.insertRows) {
        events.push(`insert:${this.table}`);
        const inserted = this.insertRows.map((row, index) => ({
          ...structuredClone(row),
          ...(this.table === "quotes" ? { id: `quote-${index + 1}`, code: "QT-TEST-001" } : {}),
        }));
        tables[this.table].push(...inserted);
        return { data: this.one ? structuredClone(inserted[0]) : structuredClone(inserted), error: null };
      }
      if (this.deleting) {
        events.push(`delete:${this.table}`);
        const removed = tables[this.table].filter((row) => this.matches(row));
        tables[this.table] = tables[this.table].filter((row) => !this.matches(row));
        if (this.table === "quotes") {
          const ids = new Set(removed.map((row) => row.id));
          tables.quote_items = tables.quote_items.filter((row) => !ids.has(row.quote_id));
        }
        return { data: removed, error: null };
      }
      const rows = tables[this.table].filter((row) => this.matches(row));
      return { data: this.one ? structuredClone(rows[0] ?? null) : structuredClone(rows), error: null };
    }
    matches(row) {
      return this.filters.every(([op, column, value]) =>
        op === "eq" ? row[column] === value : value.includes(row[column]));
    }
    then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }
  }

  let handler;
  runInNewContext(compiled, {
    exports: {}, Request, Response, Map, Date, Math, JSON, Number, String,
    Deno: { env: { get: () => "test" }, serve: (callback) => { handler = callback; } },
    require: (name) => {
      if (name === "jsr:@supabase/functions-js/edge-runtime.d.ts") return {};
      if (name.includes("supabase-js")) return { createClient: () => ({
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
        from: (table) => new Query(table),
        rpc: async (name, args) => {
          events.push(`rpc:${name}`);
          assert.equal(name, "apply_quote_shipping");
          assert.deepEqual(Object.keys(args), ["p_quote_id"]);
          if (shippingError) return { data: null, error: { message: "shipping_failed" } };
          const quote = tables.quotes.find((row) => row.id === args.p_quote_id);
          tables.quote_items.push({
            quote_id: args.p_quote_id, product_id: null, sku: "SHIPPING",
            product_name: "ค่าจัดส่งสินค้า", quantity: 1, unit_price: 100,
            discount: 0, total: 100, unit: null,
          });
          quote.subtotal = tables.quote_items
            .filter((row) => row.quote_id === args.p_quote_id)
            .reduce((sum, row) => sum + row.total, 0);
          const net = quote.subtotal - quote.discount;
          quote.vat = Math.round(net * 0.07 * 100) / 100;
          quote.total = net + quote.vat;
          return { data: null, error: null };
        },
      }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });

  return {
    tables,
    events,
    async submit() {
      const response = await handler(new Request("https://test.invalid/storefront-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer anon" },
        body: JSON.stringify({
          items: [{ sku: "2020002623", qty: 1 }],
          contact: { name: "ลูกค้าทดสอบ", phone: "0800000000" },
        }),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test("storefront quote appends server-owned shipping and recalculates totals", async () => {
  const h = storefront();
  const result = await h.submit();

  assert.equal(result.status, 200);
  assert.equal(result.body.code, "QT-TEST-001");
  assert.deepEqual(h.events, ["insert:quotes", "insert:quote_items", "rpc:apply_quote_shipping"]);
  assert.deepEqual(h.tables.quote_items.map((row) => row.sku), ["2020002623", "SHIPPING"]);
  assert.equal(h.tables.quotes[0].subtotal, 1300);
  assert.equal(h.tables.quotes[0].vat, 91);
  assert.equal(h.tables.quotes[0].total, 1391);
});

test("storefront quote removes an incomplete draft when shipping cannot be added", async () => {
  const h = storefront({ shippingError: true });
  const result = await h.submit();

  assert.equal(result.status, 500);
  assert.match(result.body.error, /ค่าขนส่ง/);
  assert.deepEqual(h.events, [
    "insert:quotes", "insert:quote_items", "rpc:apply_quote_shipping", "delete:quotes",
  ]);
  assert.equal(h.tables.quotes.length, 0);
  assert.equal(h.tables.quote_items.length, 0);
});

test("customer quote view keeps every shipping line last without changing product order", () => {
  const input = [
    { sku: "SHIPPING", product_name: "ค่าจัดส่งสินค้า" },
    { sku: "A", product_name: "สินค้า A" },
    { sku: "B", product_name: "สินค้า B" },
  ];

  const sorted = quoteItemsShippingLast(input);
  assert.deepEqual(sorted.map((row) => row.sku), ["A", "B", "SHIPPING"]);
  assert.deepEqual(input.map((row) => row.sku), ["SHIPPING", "A", "B"]);
});
