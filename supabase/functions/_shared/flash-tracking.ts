const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export interface FlashDeliveredSnapshot {
  status: "delivered";
  updatedAt: string;
}

export function parseFlashDatabaseSnapshot(
  value: unknown,
): FlashDeliveredSnapshot | null {
  const row = Array.isArray(value) ? record(value[0]) : record(value);
  if (row.delivered !== true) return null;
  const timestamp = Date.parse(String(row.updated_at ?? ""));
  if (!Number.isFinite(timestamp)) return null;
  return { status: "delivered", updatedAt: new Date(timestamp).toISOString() };
}
