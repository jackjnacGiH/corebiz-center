// Provider transport. No credentials or provider response bodies are logged.
export interface ProviderConfig {
  environment: "uat" | "production";
  appId: string;
  secret: string;
  specConfirmed: boolean;
  readsEnabled: boolean;
  mutationsEnabled: boolean;
}
export const providerBase = (e: ProviderConfig["environment"]) =>
  e === "production"
    ? "https://openapi.promptspeed.co.th"
    : "https://openapi-uat.promptspeed.co.th";
export async function signQuery(
  appId: string,
  secret: string,
  query: Record<string, string | string[]>,
  timestamp = Date.now(),
): Promise<URLSearchParams> {
  if (["key", "timestamp", "signature"].some((k) => k in query))
    throw new Error("reserved_query_key");
  const key = btoa(`${timestamp}-${appId}`);
  const signed: Record<string, string | string[]> = {
    ...query,
    key,
    timestamp: String(timestamp),
  };
  const base =
    "secret=" +
    secret +
    Object.keys(signed)
      .sort()
      .map((k) =>
        (Array.isArray(signed[k]) ? signed[k] : [signed[k]])
          .map((v) => `${k}=${v}`)
          .join(""),
      )
      .join("");
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        new TextEncoder().encode(base),
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const params = new URLSearchParams();
  for (const [k, values] of Object.entries(signed))
    for (const v of Array.isArray(values) ? values : [values])
      params.append(k, v);
  params.set("signature", signature);
  return params;
}
const operations = {
  carriers: ["GET", "/api/v3/carrier/list", false],
  quote: ["POST", "/api/v3/shipment/check-price", false],
  create: ["POST", "/api/v3/shipment", true],
  print: ["POST", "/api/v3/shipment/print", false],
  list: ["GET", "/api/v3/shipment", false],
  cancel: ["PUT", "/api/v3/shipment/cancel/", true],
} as const;
export function assertProviderReady(
  config: ProviderConfig,
  mutation: boolean,
): void {
  if (
    !config.specConfirmed ||
    !config.readsEnabled ||
    !config.appId ||
    !config.secret ||
    (mutation && !config.mutationsEnabled)
  )
    throw new Error("provider_not_ready");
}
export async function requestProvider(
  config: ProviderConfig,
  operation: keyof typeof operations,
  body?: unknown,
  query: Record<string, string> = {},
  tracking?: string,
  fetcher: typeof fetch = fetch,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const [method, route, mutation] = operations[operation];
  assertProviderReady(config, mutation);
  if (
    operation === "cancel" &&
    (!tracking || !/^[A-Za-z0-9-]{5,80}$/.test(tracking))
  )
    throw new Error("invalid_tracking");
  const url =
    providerBase(config.environment) +
    route +
    (operation === "cancel" ? encodeURIComponent(tracking!) : "") +
    "?" +
    (await signQuery(config.appId, config.secret, query));
  const response = await fetcher(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  if (raw.length > 2000000) throw new Error("provider_response_invalid");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("provider_response_invalid");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("provider_response_invalid");
  return { status: response.status, data: data as Record<string, unknown> };
}
