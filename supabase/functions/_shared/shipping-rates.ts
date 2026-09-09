import { quoteIssues, quotePayload, shippingParcels, type ShippingDraft, type ShippingParcel } from "./shipping-domain.ts";
import { requestProvider, type ProviderConfig } from "./promptspeed.ts";

export interface ShippingCarrier {
  code: string;
  name: string;
  logo: string | null;
}
export interface ShippingRate {
  carrier: string;
  carrier_code: string;
  logo: string | null;
  available: boolean;
  total: string | null;
  delivery_time: string;
  parcel_count: number;
  quoted_parcels: number;
  cheapest: boolean;
  parcels: { number: number; total: string | null }[];
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v.trim().slice(0, 200) : "";
function rateUnits(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value);
  if (!/^\d{1,9}(\.\d{1,4})?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  return Number(whole) * 10000 + Number(fraction.padEnd(4, "0"));
}
const amount = (units: number) => `${Math.floor(units / 10000)}.${String(units % 10000).padStart(4, "0")}`;
function logoUrl(v: unknown): string | null {
  try {
    const u = new URL(text(v));
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

export function aggregateShippingRates(carriers: ShippingCarrier[], responses: unknown[][]): ShippingRate[] {
  const rows = carriers.map((carrier) => {
    const times = new Set<string>();
    let total = 0;
    const parcels = responses.map((response, index) => {
      const matches = response.map(record).filter((row) => row.carrier_code === carrier.code);
      const row = matches.length === 1 ? matches[0] : {};
      const units = rateUnits(row.total);
      if (units !== null) {
        total += units;
        const deliveryTime = text(row.delivery_time);
        if (deliveryTime) times.add(deliveryTime);
      }
      return { number: index + 1, total: units === null ? null : amount(units) };
    });
    const quoted = parcels.filter((p) => p.total !== null).length;
    return {
      carrier: carrier.name, carrier_code: carrier.code, logo: carrier.logo,
      available: quoted === responses.length && responses.length > 0,
      total: quoted === responses.length && responses.length > 0 ? amount(total) : null,
      delivery_time: [...times].join(" / "), parcel_count: responses.length,
      quoted_parcels: quoted, cheapest: false, parcels,
    };
  });
  rows.sort((a, b) => Number(b.available) - Number(a.available) ||
    Number(a.total ?? Infinity) - Number(b.total ?? Infinity) || a.carrier_code.localeCompare(b.carrier_code));
  const cheapest = rows.find((r) => r.available)?.total;
  return rows.map((row) => ({ ...row, cheapest: row.available && row.total === cheapest }));
}

export async function compareShippingRates(
  config: ProviderConfig,
  draft: ShippingDraft,
  selectedCodes?: string[],
  request: typeof requestProvider = requestProvider,
): Promise<{ rates: ShippingRate[]; parcel_count: number; quoted_at: string }> {
  if (quoteIssues(draft).length) throw new Error("quote_incomplete");
  // Only these read operations can retry a dropped connection; shipment writes never do.
  const read = async (operation: "carriers" | "quote", body?: unknown, query?: Record<string, string>) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await request(config, operation, body, query);
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        return response;
      } catch (error) {
        if (attempt > 0 || (error instanceof Error && error.message === "provider_not_ready")) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  };
  const carrierResponse = await read("carriers", undefined, { limit: "100" });
  if (carrierResponse.status !== 200 || !Array.isArray(carrierResponse.data.data))
    throw new Error("provider_rejected");
  const carriers = carrierResponse.data.data.map(record).map((row) => ({
    code: text(row.code), name: text(row.description) || text(row.name) || text(row.code),
    logo: logoUrl(row.logo),
  })).filter((row) => /^[A-Za-z0-9_&-]{1,80}$/.test(row.code) &&
    (!selectedCodes || selectedCodes.includes(row.code)));
  const uniqueCarriers = [...new Map(carriers.map((c) => [c.code, c])).values()];
  if (!uniqueCarriers.length) throw new Error("carrier_unavailable");
  const codes = uniqueCarriers.map((c) => c.code);
  const parcels = shippingParcels(draft);
  const groups = new Map<string, { parcel: ShippingParcel; indexes: number[] }>();
  parcels.forEach((parcel, index) => {
    const key = JSON.stringify([parcel.box_width, parcel.box_height, parcel.box_length, parcel.box_weight]);
    const group = groups.get(key) ?? { parcel, indexes: [] };
    group.indexes.push(index);
    groups.set(key, group);
  });
  const queue = [...groups.values()];
  const responses: unknown[][] = Array.from({ length: parcels.length }, () => []);
  let next = 0;
  // Reuse identical parcel quotes and bound concurrent calls for larger shipments.
  const startedAt = Date.now();
  const results = await Promise.allSettled(Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (next < queue.length) {
      if (Date.now() - startedAt > 50000) throw new Error("provider_rejected");
      const group = queue[next++];
      const response = await read("quote", quotePayload(draft, codes, group.parcel));
      if (response.status !== 200 || !Array.isArray(response.data.data))
        throw new Error("provider_rejected");
      for (const index of group.indexes) responses[index] = response.data.data;
    }
  }));
  if (results.some((result) => result.status === "rejected")) throw new Error("provider_rejected");
  return { rates: aggregateShippingRates(uniqueCarriers, responses), parcel_count: parcels.length, quoted_at: new Date().toISOString() };
}
