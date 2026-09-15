import { supabase } from './supabase';

export interface CustomerNetPriceRule {
  id: string;
  customer_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  unit: string;
  min_order_qty: number;
  net_price: number;
  active: boolean;
  valid_from: string;
  valid_until: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerPricingProduct {
  id: string;
  sku: string;
  name_th: string;
  name_en: string | null;
  unit: string;
  min_order_qty: number;
  price: number;
  discount_type: string;
  discount_value: number;
  updated_at: string;
}

export interface ResolvedCustomerPrice {
  product_id: string;
  sku: string | null;
  unit: string;
  quantity: number;
  list_price: number;
  normal_discount_type: string | null;
  normal_discount_value: number;
  base_price: number;
  tier: string | null;
  tier_percent: number;
  net_rule_id: string | null;
  net_price: number | null;
  final_price: number;
  price_source: 'base' | 'tier' | 'customer_net' | 'flowaccount_quote' | string;
  resolved_at: string | null;
}

export interface CustomerNetPriceRuleInput {
  customer_id: string;
  product_id: string;
  unit: string;
  net_price: number;
  active: boolean;
  valid_from: string;
  valid_until: string | null;
  note: string | null;
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normaliseResolvedCustomerPrices(value: unknown): ResolvedCustomerPrice[] {
  const payload = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  return payload
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      product_id: String(row.product_id ?? ''),
      sku: row.sku == null ? null : String(row.sku),
      unit: String(row.unit ?? ''),
      quantity: asNumber(row.quantity),
      list_price: asNumber(row.list_price),
      normal_discount_type: row.normal_discount_type == null ? null : String(row.normal_discount_type),
      normal_discount_value: asNumber(row.normal_discount_value),
      base_price: asNumber(row.base_price),
      tier: row.tier == null ? null : String(row.tier),
      tier_percent: asNumber(row.tier_percent),
      net_rule_id: row.net_rule_id == null ? null : String(row.net_rule_id),
      net_price: row.net_price == null ? null : asNumber(row.net_price),
      final_price: asNumber(row.final_price),
      price_source: String(row.price_source ?? 'base'),
      resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
    }))
    .filter((row) => row.product_id !== '');
}

export const customerPricingApi = {
  async listRules(customerId: string): Promise<CustomerNetPriceRule[]> {
    const { data, error } = await (supabase.rpc as CallableFunction)(
      'list_customer_product_net_prices',
      { p_customer_id: customerId },
    );
    if (error) throw error;
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      customer_id: String(row.customer_id),
      product_id: String(row.product_id),
      sku: String(row.sku ?? ''),
      product_name: String(row.product_name ?? ''),
      unit: String(row.unit ?? ''),
      min_order_qty: Math.max(1, Math.floor(asNumber(row.min_order_qty) || 1)),
      net_price: asNumber(row.net_price),
      active: Boolean(row.active),
      valid_from: String(row.valid_from),
      valid_until: row.valid_until == null ? null : String(row.valid_until),
      note: row.note == null ? null : String(row.note),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }));
  },

  async searchProducts(term: string, limit = 20): Promise<CustomerPricingProduct[]> {
    const query = term.trim().replace(/[,()*]/g, ' ').trim();
    if (query.length < 2) return [];
    const safeLimit = Math.min(30, Math.max(1, Math.floor(limit)));
    const { data, error } = await supabase
      .from('products')
      .select('id,sku,name_th,name_en,unit,min_order_qty,price,discount_type,discount_value,updated_at')
      .eq('status', 'active')
      .or(`sku.ilike.*${query}*,name_th.ilike.*${query}*,name_en.ilike.*${query}*`)
      .order('sku', { ascending: true })
      .limit(safeLimit);
    if (error) throw error;
    return (data ?? []) as CustomerPricingProduct[];
  },

  async resolvePrices(
    customerId: string,
    items: Array<{ product_id: string; unit: string; quantity: number }>,
  ): Promise<ResolvedCustomerPrice[]> {
    if (items.length === 0) return [];
    const { data, error } = await (supabase.rpc as CallableFunction)(
      'resolve_customer_quote_prices',
      { p_customer_id: customerId, p_items: items },
    );
    if (error) throw error;
    return normaliseResolvedCustomerPrices(data);
  },

  async createRule(input: CustomerNetPriceRuleInput): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('customer_product_net_prices')
      .insert(input)
      .select('id')
      .single();
    if (error) throw error;
    return String(data.id);
  },

  async updateRule(
    customerId: string,
    ruleId: string,
    patch: Partial<Omit<CustomerNetPriceRuleInput, 'customer_id' | 'product_id'>>,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('customer_product_net_prices')
      .update(patch)
      .eq('id', ruleId)
      .eq('customer_id', customerId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('ไม่พบราคาที่ต้องการแก้ หรือไม่มีสิทธิ์แก้ไข');
  },

  async expireRule(customerId: string, ruleId: string): Promise<void> {
    await customerPricingApi.updateRule(customerId, ruleId, { active: false });
  },
};
