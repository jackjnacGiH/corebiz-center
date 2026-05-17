/**
 * CSV import/export for the customers table.
 *
 * Same patterns as inventoryCsv.ts:
 *   - UTF-8 with BOM so Excel opens Thai correctly
 *   - Pipe `|` as the inner separator for `tags`
 *   - Required: name. `code` is optional but recommended (unique).
 *   - On import: if `code` matches an existing customer → UPDATE,
 *                 otherwise INSERT.
 *   - Unknown enum values (customer_type, tier) get coerced to defaults
 *     and produce a warning, not a hard error.
 *
 * Addresses are stored in the DB as `jsonb` (billing_address, shipping_address)
 * but we **flatten** them into separate columns for the CSV so users can edit
 * comfortably in Excel:
 *
 *   billing_line, billing_subdistrict, billing_district, billing_province, billing_postcode
 *   shipping_line, shipping_subdistrict, shipping_district, shipping_province, shipping_postcode
 *
 * Empty address blocks round-trip as NULL.
 */
import Papa from 'papaparse';
import type { Customer, CustomerInsert, Json } from './database.types';

export const CUSTOMERS_CSV_HEADERS = [
    'code',
    'name',
    'customer_type',
    'tier',
    'email',
    'phone',
    'tax_id',
    'notes',
    'tags',
    'billing_line',
    'billing_subdistrict',
    'billing_district',
    'billing_province',
    'billing_postcode',
    'shipping_line',
    'shipping_subdistrict',
    'shipping_district',
    'shipping_province',
    'shipping_postcode',
] as const;

export type CustomerCsvHeader = (typeof CUSTOMERS_CSV_HEADERS)[number];
export type CustomerCsvRow = { [K in CustomerCsvHeader]: string };

interface AddressShape {
    line?: string;
    subdistrict?: string;
    district?: string;
    province?: string;
    postcode?: string;
}

function readAddr(v: unknown): AddressShape {
    if (!v || typeof v !== 'object') return {};
    const o = v as Record<string, unknown>;
    return {
        line:        typeof o.line === 'string' ? o.line : '',
        subdistrict: typeof o.subdistrict === 'string' ? o.subdistrict : '',
        district:    typeof o.district === 'string' ? o.district : '',
        province:    typeof o.province === 'string' ? o.province : '',
        postcode:    typeof o.postcode === 'string' ? o.postcode : '',
    };
}

function addrFromRow(
    row: Record<string, string>,
    prefix: 'billing' | 'shipping',
): AddressShape | null {
    const a: AddressShape = {
        line:        cell(row[`${prefix}_line`]),
        subdistrict: cell(row[`${prefix}_subdistrict`]),
        district:    cell(row[`${prefix}_district`]),
        province:    cell(row[`${prefix}_province`]),
        postcode:    cell(row[`${prefix}_postcode`]),
    };
    // All-empty → NULL
    if (!a.line && !a.subdistrict && !a.district && !a.province && !a.postcode) return null;
    return a;
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function customerToCsvRow(c: Customer): CustomerCsvRow {
    const billing = readAddr(c.billing_address);
    const shipping = readAddr(c.shipping_address);
    return {
        code: c.code ?? '',
        name: c.name,
        customer_type: c.customer_type ?? 'unspecified',
        tier: c.tier ?? 'general',
        email: c.email ?? '',
        phone: c.phone ?? '',
        tax_id: c.tax_id ?? '',
        notes: c.notes ?? '',
        tags: Array.isArray(c.tags) ? c.tags.join('|') : '',
        billing_line:        billing.line ?? '',
        billing_subdistrict: billing.subdistrict ?? '',
        billing_district:    billing.district ?? '',
        billing_province:    billing.province ?? '',
        billing_postcode:    billing.postcode ?? '',
        shipping_line:        shipping.line ?? '',
        shipping_subdistrict: shipping.subdistrict ?? '',
        shipping_district:    shipping.district ?? '',
        shipping_province:    shipping.province ?? '',
        shipping_postcode:    shipping.postcode ?? '',
    };
}

export function buildCustomersCsv(customers: Customer[]): string {
    const rows = customers.map(customerToCsvRow);
    return Papa.unparse(
        { fields: [...CUSTOMERS_CSV_HEADERS], data: rows },
        { quotes: true, newline: '\r\n' },
    );
}

/** Trigger a UTF-8-BOM browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
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

// ─── Import ──────────────────────────────────────────────────────────────────

export interface ParsedCustomerRow {
    line: number;
    /** Empty if the row had no code — will INSERT a new customer */
    code: string;
    customer: CustomerInsert;
    warnings: string[];
}

export interface CustomerImportPreview {
    valid: ParsedCustomerRow[];
    errors: Array<{ line: number; code?: string; message: string }>;
    /** codes that match an existing customer (UPDATE) */
    updates: Set<string>;
    /** codes that don't exist yet, OR rows without a code (INSERT) */
    inserts: Set<string>; // contains '' for code-less inserts
    /** Number of code-less rows (every one is a separate INSERT) */
    codelessInserts: number;
}

const VALID_TYPES = new Set(['company', 'shop', 'individual', 'unspecified']);
const VALID_TIERS = new Set(['general', 'silver', 'gold', 'vip']);

function cell(v: unknown): string {
    if (v == null) return '';
    const s = String(v).trim();
    return s === '-' ? '' : s;
}

export function parseCustomersCsv(
    csvText: string,
    existingCustomers: Customer[],
): CustomerImportPreview {
    const parsed = Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
    });

    const valid: ParsedCustomerRow[] = [];
    const errors: CustomerImportPreview['errors'] = [];
    const updates = new Set<string>();
    const inserts = new Set<string>();
    let codelessInserts = 0;

    if (parsed.errors.length > 0) {
        for (const e of parsed.errors) {
            errors.push({
                line: (e.row ?? 0) + 2,
                message: e.message,
            });
        }
    }

    const codeToCustomer = new Map(
        existingCustomers.filter((c) => c.code).map((c) => [c.code!, c]),
    );
    const seenCodeInFile = new Set<string>();

    parsed.data.forEach((rawRow, idx) => {
        const line = idx + 2;
        const code = cell(rawRow.code);
        const name = cell(rawRow.name);

        if (!name) {
            errors.push({ line, code: code || undefined, message: 'name ว่าง — ข้ามแถวนี้' });
            return;
        }
        if (code && seenCodeInFile.has(code)) {
            errors.push({ line, code, message: `code ${code} ซ้ำในไฟล์ — ข้าม` });
            return;
        }
        if (code) seenCodeInFile.add(code);

        const warnings: string[] = [];

        let customer_type = cell(rawRow.customer_type) || 'unspecified';
        if (!VALID_TYPES.has(customer_type)) {
            warnings.push(`customer_type "${customer_type}" ไม่ถูกต้อง → ใช้ unspecified`);
            customer_type = 'unspecified';
        }

        let tier = cell(rawRow.tier) || 'general';
        if (!VALID_TIERS.has(tier)) {
            warnings.push(`tier "${tier}" ไม่ถูกต้อง → ใช้ general`);
            tier = 'general';
        }

        const tags = cell(rawRow.tags)
            .split('|')
            .map((t) => t.trim())
            .filter(Boolean);

        const billing_address = addrFromRow(rawRow, 'billing');
        const shipping_address = addrFromRow(rawRow, 'shipping');

        const customer: CustomerInsert = {
            code: code || null,
            name,
            customer_type,
            tier,
            email: cell(rawRow.email) || null,
            phone: cell(rawRow.phone) || null,
            tax_id: cell(rawRow.tax_id) || null,
            notes: cell(rawRow.notes) || null,
            tags,
            // AddressShape is a strict-keyed interface but the DB column is Json
            // (an index-signature type); cast at the boundary.
            billing_address: billing_address as Json | null,
            shipping_address: shipping_address as Json | null,
        };

        valid.push({ line, code, customer, warnings });

        if (code) {
            if (codeToCustomer.has(code)) updates.add(code);
            else inserts.add(code);
        } else {
            codelessInserts += 1;
        }
    });

    return { valid, errors, updates, inserts, codelessInserts };
}
