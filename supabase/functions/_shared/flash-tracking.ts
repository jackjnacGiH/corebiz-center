// Flash's public tracking page reads this first-party endpoint. Keep this
// adapter deliberately narrow: it only confirms the terminal delivered state
// when PromptSpeed still reports an active shipment.
const FLASH_TRACKING_URL = "https://www.flashexpress.co.th/webApi/tools/tracking";
const FLASH_DELIVERED_STATE = 5;
const FLASH_DELIVERED_ACTION = "DELIVERY_CONFIRM";
const MAX_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 5_000;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const validTracking = (value: string) => /^[A-Za-z0-9-]{5,80}$/.test(value);

export interface FlashDeliveredSnapshot {
  status: "delivered";
  updatedAt: string;
}

export function parseFlashDeliveredSnapshot(
  payload: unknown,
  expectedTracking: string,
): FlashDeliveredSnapshot | null {
  const root = record(payload);
  if (Number(root.code) !== 1) return null;
  const rows = record(root.data).list;
  if (!Array.isArray(rows)) return null;
  const expected = expectedTracking.toUpperCase();
  const shipment = rows
    .map(record)
    .find((row) => {
      const tracking = String(
        row.search_no ?? row.search_no_display ?? row.pno_display ?? "",
      ).trim().toUpperCase();
      return tracking === expected;
    });
  if (!shipment || Number(shipment.state) !== FLASH_DELIVERED_STATE)
    return null;
  const deliveredRoute = Array.isArray(shipment.routes)
    ? shipment.routes.map(record).find((route) =>
      String(route.route_action ?? "").trim().toUpperCase() ===
          FLASH_DELIVERED_ACTION &&
        Number(route.state) === FLASH_DELIVERED_STATE
    )
    : undefined;
  if (!deliveredRoute) return null;
  const rawUpdatedAt = String(deliveredRoute.routed_at ?? "").trim();
  const normalizedUpdatedAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(
      rawUpdatedAt,
    )
    ? `${rawUpdatedAt.replace(" ", "T")}+07:00`
    : rawUpdatedAt;
  const timestamp = Date.parse(normalizedUpdatedAt);
  if (!Number.isFinite(timestamp)) return null;
  return { status: "delivered", updatedAt: new Date(timestamp).toISOString() };
}

export async function flashDeliveredSnapshot(
  trackingNumber: string,
  fetcher: typeof fetch = fetch,
): Promise<FlashDeliveredSnapshot | null> {
  if (!validTracking(trackingNumber)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(FLASH_TRACKING_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Accept-Language": "th-TH,th;q=0.9",
      },
      body: JSON.stringify({ search: trackingNumber }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const raw = await response.text();
    if (!raw || raw.length > MAX_RESPONSE_BYTES) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
    return parseFlashDeliveredSnapshot(payload, trackingNumber);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
