import { readFile } from "node:fs/promises";
import path from "node:path";

import type { PriceRule, ProductRecord } from "@/lib/types";

async function readJsonl<T>(filePath: string): Promise<T[]> {
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

export async function readLocalProducts() {
  const candidates = [
    path.resolve(process.cwd(), "data", "jnac_admin_products.jsonl"),
    path.resolve(process.cwd(), "..", "jnac_admin_products.jsonl"),
  ];

  for (const candidate of candidates) {
    const rows = await readJsonl<ProductRecord>(candidate);
    if (rows.length) return rows;
  }
  return [];
}

export async function readLocalPriceRules() {
  const candidates = [
    path.resolve(process.cwd(), "data", "jnac_product_price_rules.jsonl"),
    path.resolve(process.cwd(), "..", "jnac_product_price_rules.jsonl"),
  ];

  for (const candidate of candidates) {
    const rows = await readJsonl<PriceRule>(candidate);
    if (rows.length) return rows;
  }
  return [];
}
