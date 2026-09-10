export const SHIPPING_PROVIDER_ISSUES = [
  "invalid_phone",
  "box_dimension_exceeded",
  "invalid_box_weight",
  "invalid_address",
  "invalid_postcode",
  "wallet_insufficient",
  "carrier_service_unavailable",
  "provider_authentication_failed",
  "provider_rate_limited",
  "provider_validation_failed",
] as const;

export type ShippingProviderIssue = typeof SHIPPING_PROVIDER_ISSUES[number];

export function isShippingProviderIssue(value: unknown): value is ShippingProviderIssue {
  return typeof value === "string" &&
    (SHIPPING_PROVIDER_ISSUES as readonly string[]).includes(value);
}
