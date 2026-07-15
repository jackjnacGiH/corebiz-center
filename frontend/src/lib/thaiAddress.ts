/**
 * Thai address lookup — postcode → {subdistrict, district, province}.
 *
 * Dataset is the compact `db.json` from `thai-address-database` v0.0.31
 * (ISC license, Sellsuki / earthchie). We copy the JSON in directly instead of depending on
 * the npm package — the package shipped mocha + the entire babel toolchain as
 * runtime deps, dragging in vulnerabilities. The actual data is just a
 * hierarchical list, license-clean to redistribute. Refresh both vendored
 * address files with `node scripts/update-thai-address-data.mjs`.
 *
 * The original format compresses repeated strings via a `lookup` index and a
 * `words` table that swaps A-Z letters for common Thai morphemes. We mirror
 * the same `preprocess()` algorithm so we get an expanded
 *   { subdistrict, district, province, postcode }[]
 * list, then build a Map keyed by postcode for O(1) lookup.
 *
 * Everything is dynamic-imported on first call so the 200KB JSON doesn't bloat
 * the main bundle — it loads on demand the first time someone opens the
 * customer modal and types a postcode.
 */

export interface ThaiAddressEntry {
    /** ตำบล / แขวง (was "district" in upstream — renamed for clarity) */
    subdistrict: string;
    /** อำเภอ / เขต (was "amphoe" in upstream) */
    district: string;
    /** จังหวัด */
    province: string;
    /** รหัสไปรษณีย์ */
    postcode: string;
}

type CurrentAddress = Partial<Pick<ThaiAddressEntry, 'subdistrict' | 'district' | 'province'>>;

/**
 * Resolve the fields that can safely be auto-filled for a postcode.
 *
 * A postcode can span several districts (10120 spans Yan Nawa, Sathon, and
 * Bang Kho Laem). If the existing subdistrict identifies one unique tuple, we
 * select that whole tuple. Otherwise only fields common to every option are
 * filled, and the district remains blank until the user chooses an option.
 */
export function resolveThaiAddressAutofill(
    matches: ThaiAddressEntry[],
    current: CurrentAddress = {},
): Pick<ThaiAddressEntry, 'subdistrict' | 'district' | 'province'> {
    if (matches.length === 0) {
        return { subdistrict: '', district: '', province: '' };
    }

    const exact = matches.find((entry) =>
        entry.subdistrict === current.subdistrict &&
        entry.district === current.district &&
        entry.province === current.province
    );
    const sameSubdistrict = matches.filter((entry) =>
        entry.subdistrict === current.subdistrict
    );
    const selected = exact ?? (sameSubdistrict.length === 1 ? sameSubdistrict[0] : undefined);
    if (selected) {
        return {
            subdistrict: selected.subdistrict,
            district: selected.district,
            province: selected.province,
        };
    }

    const districtPairs = new Set(matches.map((entry) =>
        `${entry.district}\u0000${entry.province}`
    ));
    const provinces = new Set(matches.map((entry) => entry.province));
    return {
        subdistrict: '',
        district: districtPairs.size === 1 ? matches[0].district : '',
        province: provinces.size === 1 ? matches[0].province : '',
    };
}

/** Compact upstream JSON format. */
interface CompactDb {
    data: unknown[];
    lookup: string;
    words: string;
}

let zipIndexPromise: Promise<Map<string, ThaiAddressEntry[]>> | null = null;

async function loadIndex(): Promise<Map<string, ThaiAddressEntry[]>> {
    if (!zipIndexPromise) {
        zipIndexPromise = (async () => {
            const mod = await import('./thaiAddress.json');
            const raw = (mod.default ?? mod) as unknown as CompactDb;
            const entries = expand(raw);
            const map = new Map<string, ThaiAddressEntry[]>();
            const seen = new Set<string>();
            for (const e of entries) {
                const key = `${e.postcode}\u0000${e.subdistrict}\u0000${e.district}\u0000${e.province}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const bucket = map.get(e.postcode);
                if (bucket) bucket.push(e);
                else map.set(e.postcode, [e]);
            }
            return map;
        })();
    }
    return zipIndexPromise;
}

/**
 * Lookup all (subdistrict, district, province) tuples that share a postcode.
 * Returns `[]` for unknown postcodes — caller decides whether to warn.
 */
export async function lookupZipcode(postcode: string): Promise<ThaiAddressEntry[]> {
    const clean = postcode.trim();
    if (!/^\d{5}$/.test(clean)) return [];
    const index = await loadIndex();
    return index.get(clean) ?? [];
}

// ─── preprocess: port of thai-address-database/lib/index.js#preprocess ──────

function expand(db: CompactDb): ThaiAddressEntry[] {
    const lookup = db.lookup.split('|');
    const words = db.words.split('|');

    function decodeWord(m: string): string {
        const ch = m.charCodeAt(0);
        return words[ch < 97 ? ch - 65 : 26 + ch - 97] ?? m;
    }

    function decode(text: string | number): string {
        const raw = typeof text === 'number' ? lookup[text] : text;
        if (!raw) return '';
        return raw.replace(/[A-Z]/gi, decodeWord);
    }

    const out: ThaiAddressEntry[] = [];
    const data = db.data as Array<[string | number, unknown[]]>;

    for (const provinceRow of data) {
        const province = decode(provinceRow[0]);
        const amphoes = provinceRow[1] as Array<[string | number, unknown[]]>;
        for (const amphoeRow of amphoes) {
            const district = decode(amphoeRow[0]);
            const tambons = amphoeRow[1] as Array<[string | number, string | string[]]>;
            for (const tambonRow of tambons) {
                const subdistrict = decode(tambonRow[0]);
                const zips = Array.isArray(tambonRow[1]) ? tambonRow[1] : [tambonRow[1]];
                for (const zip of zips) {
                    out.push({ subdistrict, district, province, postcode: String(zip) });
                }
            }
        }
    }
    return out;
}
