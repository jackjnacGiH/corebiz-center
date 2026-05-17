/**
 * CSV import/export schema for products + their default-warehouse inventory.
 *
 * Column order in the CSV matters for human readability (Excel default
 * column order); when parsing we use field names so users can reorder
 * columns or omit optional ones.
 *
 * Multi-value columns use the pipe `|` as the inner separator (because
 * the values themselves may contain commas — esp. tags/descriptions):
 *   feature_tags  → "Steel|Aluminium"
 *   images        → "https://...|https://..."
 *
 * Category is matched by SLUG (human-friendly) rather than UUID so that
 * users can edit CSVs by hand. An unknown slug becomes `category_id =
 * NULL` and is reported as a warning.
 */
import Papa from 'papaparse';
import type { Category, ProductInsert } from './database.types';
import type { ProductWithInventory } from './api';

// ─── CSV column shape ────────────────────────────────────────────────────────

export const INVENTORY_CSV_HEADERS = [
    'sku',
    'name_th',
    'name_en',
    'description_th',
    'description_en',
    'brand',
    'category_slug',
    'unit',
    'price',
    'cost',
    'discount_value',
    'discount_type',
    'weight_kg',
    'reorder_level',
    'initial_quantity',
    'status',
    'feature_tags',
    'images',
] as const;

export type InventoryCsvHeader = (typeof INVENTORY_CSV_HEADERS)[number];

export type InventoryCsvRow = {
    [K in InventoryCsvHeader]: string;
};

// ─── Export: products → CSV string + download ────────────────────────────────

function getHeroImages(p: ProductWithInventory): string[] {
    if (!Array.isArray(p.images)) return [];
    return (p.images as unknown[]).filter((x): x is string => typeof x === 'string');
}

/** Convert one product (with its default-warehouse inventory) to a CSV row. */
export function productToCsvRow(p: ProductWithInventory): InventoryCsvRow {
    const inv0 = p.inventory[0];
    const tags = Array.isArray(p.feature_tags) ? p.feature_tags : [];
    const imgs = getHeroImages(p);
    return {
        sku: p.sku,
        name_th: p.name_th,
        name_en: p.name_en ?? '',
        description_th: p.description_th ?? '',
        description_en: p.description_en ?? '',
        brand: p.brand ?? '',
        category_slug: p.category?.slug ?? '',
        unit: p.unit ?? '',
        price: String(Number(p.price ?? 0)),
        cost: p.cost == null ? '' : String(Number(p.cost)),
        discount_value: String(Number(p.discount_value ?? 0)),
        discount_type: p.discount_type ?? 'fixed',
        weight_kg: p.weight_kg == null ? '' : String(Number(p.weight_kg)),
        reorder_level: inv0 == null ? '' : String(inv0.reorder_level ?? 0),
        initial_quantity: inv0 == null ? '' : String(inv0.quantity ?? 0),
        status: p.status ?? 'active',
        feature_tags: tags.join('|'),
        images: imgs.join('|'),
    };
}

/** Build CSV text for a list of products. */
export function buildInventoryCsv(products: ProductWithInventory[]): string {
    const rows = products.map(productToCsvRow);
    return Papa.unparse(
        { fields: [...INVENTORY_CSV_HEADERS], data: rows },
        { quotes: true, newline: '\r\n' },
    );
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
    // Prepend UTF-8 BOM so Excel opens Thai text correctly
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Import: parse CSV → validated rows + diff against existing products ─────

export interface ParsedRow {
    /** 1-based row number in the original CSV (header is row 1) */
    line: number;
    sku: string;
    /** Final ProductInsert (without category resolved yet) */
    product: Omit<ProductInsert, 'category_id'>;
    /** Slug from CSV (may be empty); resolved by the import caller */
    category_slug: string;
    /** Initial inventory in the default warehouse */
    initial_quantity: number;
    reorder_level: number;
    /** Non-fatal warnings — row will still be imported */
    warnings: string[];
}

export interface ImportPreview {
    valid: ParsedRow[];
    /** Rows that failed validation and will be skipped */
    errors: Array<{ line: number; sku?: string; message: string }>;
    /** SKUs in `valid` that already exist in DB (will be UPDATE on commit) */
    updates: Set<string>;
    /** SKUs in `valid` that don't exist in DB (will be INSERT on commit) */
    inserts: Set<string>;
}

const VALID_STATUSES = new Set(['active', 'draft', 'archived']);
const VALID_DISCOUNT_TYPES = new Set(['fixed', 'percent']);

/** Trim a cell + treat empty/'-' as missing. */
function cell(v: unknown): string {
    if (v == null) return '';
    const s = String(v).trim();
    return s === '-' ? '' : s;
}

function parseNumber(s: string, fallback = 0): number {
    if (!s) return fallback;
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a CSV file's text into validated rows, then diff against the
 * existing products list to figure out which will be INSERT vs UPDATE.
 *
 * Rows missing `sku` or `name_th` are pushed to `errors`. Other issues
 * (unknown category slug, invalid status, etc.) produce warnings but
 * the row is kept (best-effort import).
 */
export function parseInventoryCsv(
    csvText: string,
    existingProducts: ProductWithInventory[],
    categories: Category[],
): ImportPreview {
    const parsed = Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
    });

    const valid: ParsedRow[] = [];
    const errors: ImportPreview['errors'] = [];
    const updates = new Set<string>();
    const inserts = new Set<string>();

    if (parsed.errors.length > 0) {
        for (const e of parsed.errors) {
            errors.push({
                line: (e.row ?? 0) + 2, // +2 = 1-based + header row
                message: e.message,
            });
        }
    }

    const knownSkus = new Set(existingProducts.map((p) => p.sku));
    const slugToCategory = new Map(categories.map((c) => [c.slug, c]));
    const seenSkuInFile = new Set<string>();

    parsed.data.forEach((rawRow, idx) => {
        const line = idx + 2;
        const sku = cell(rawRow.sku).toUpperCase();
        const name_th = cell(rawRow.name_th);

        if (!sku) {
            errors.push({ line, message: 'sku ว่าง — ข้ามแถวนี้' });
            return;
        }
        if (!name_th) {
            errors.push({ line, sku, message: 'name_th ว่าง — ข้ามแถวนี้' });
            return;
        }
        if (seenSkuInFile.has(sku)) {
            errors.push({ line, sku, message: `sku ${sku} ซ้ำในไฟล์ — ข้าม` });
            return;
        }
        seenSkuInFile.add(sku);

        const warnings: string[] = [];

        const category_slug = cell(rawRow.category_slug);
        if (category_slug && !slugToCategory.has(category_slug)) {
            warnings.push(`หมวด "${category_slug}" ไม่พบในระบบ → จะตั้งเป็นไม่ระบุ`);
        }

        let status = cell(rawRow.status) || 'active';
        if (!VALID_STATUSES.has(status)) {
            warnings.push(`status "${status}" ไม่ถูกต้อง → ใช้ active`);
            status = 'active';
        }

        let discount_type = cell(rawRow.discount_type) || 'fixed';
        if (!VALID_DISCOUNT_TYPES.has(discount_type)) {
            warnings.push(`discount_type "${discount_type}" ไม่ถูกต้อง → ใช้ fixed`);
            discount_type = 'fixed';
        }

        const feature_tags = cell(rawRow.feature_tags)
            .split('|')
            .map((t) => t.trim())
            .filter(Boolean);

        const images = cell(rawRow.images)
            .split('|')
            .map((u) => u.trim())
            .filter(Boolean);

        const product: Omit<ProductInsert, 'category_id'> = {
            sku,
            name_th,
            name_en: cell(rawRow.name_en) || null,
            description_th: cell(rawRow.description_th) || null,
            description_en: cell(rawRow.description_en) || null,
            brand: cell(rawRow.brand) || null,
            unit: cell(rawRow.unit) || 'ชิ้น',
            price: parseNumber(cell(rawRow.price), 0),
            cost: rawRow.cost && cell(rawRow.cost) ? parseNumber(cell(rawRow.cost)) : null,
            discount_value: parseNumber(cell(rawRow.discount_value), 0),
            discount_type,
            weight_kg: rawRow.weight_kg && cell(rawRow.weight_kg)
                ? parseNumber(cell(rawRow.weight_kg))
                : null,
            status,
            feature_tags,
            images: images,
        };

        valid.push({
            line,
            sku,
            product,
            category_slug,
            initial_quantity: parseNumber(cell(rawRow.initial_quantity), 0),
            reorder_level: parseNumber(cell(rawRow.reorder_level), 10),
            warnings,
        });

        if (knownSkus.has(sku)) updates.add(sku);
        else inserts.add(sku);
    });

    return { valid, errors, updates, inserts };
}
