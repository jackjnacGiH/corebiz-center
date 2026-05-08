export const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS ??
  "supanrattanakool@gmail.com,sinsupan49@gmail.com,jnac.co.th@gmail.com"
)
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID ?? "1c3U81eazLDTMQTdDScObASikKgYJf_qmKabn4Lyf1Og";

export const INVENTORY_SHEET = process.env.INVENTORY_SHEET ?? "Inventory";
export const FLOWACCOUNT_SHEET =
  process.env.FLOWACCOUNT_SHEET ?? "รหัส FlowAccount";
export const PRODUCT_PRICE_GID = process.env.PRODUCT_PRICE_GID ?? "0";

export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://froaslmuvhirqvwmagln.supabase.co";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_TrGp72_EgM4lyq5TZBrvAA__kC5Uv-t";

export function getSyncSecret() {
  return process.env.CRON_SECRET ?? "";
}

export function isAdminEmail(email: string | null | undefined) {
  return Boolean(email && ADMIN_EMAILS.includes(email.trim().toLowerCase()));
}

export function hasSupabaseAuthConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export function hasSupabaseServiceConfig() {
  return Boolean(SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasOpenAIConfig() {
  return Boolean(process.env.OPENAI_API_KEY);
}
