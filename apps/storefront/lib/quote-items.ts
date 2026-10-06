export function quoteItemsShippingLast<T extends { sku?: string | null }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    Number(a.sku === "SHIPPING") - Number(b.sku === "SHIPPING")
  );
}
