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
 */
import Papa from 'papaparse';
import type { Customer, CustomerInsert } from './database.types';

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
] as const;

export type CustomerCsvHeader = (typeof CUSTOMERS_CSV_HEADERS)[number];
export type CustomerCsvRow = { [K in CustomerCsvHeader]: string };

// ─── Export ──────────────────────────────────────────────────────────────────

export function customerToCsvRow(c: Customer): CustomerCsvRow {
    return {
        code: c.code ?? '',
        name: c.name,
        customer_type: c.customer_type ?? 'individual',
        tier: c.tier ?? 'general',
        email: c.email ?? '',
        phone: c.phone ?? '',
        tax_id: c.tax_id ?? '',
        notes: c.notes ?? '',
        tags: Array.isArray(c.tags) ? c.tags.join('|') : '',
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

const VALID_TYPES = new Set(['individual', 'company']);
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

        let customer_type = cell(rawRow.customer_type) || 'individual';
        if (!VALID_TYPES.has(customer_type)) {
            warnings.push(`customer_type "${customer_type}" ไม่ถูกต้อง → ใช้ individual`);
            customer_type = 'individual';
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
