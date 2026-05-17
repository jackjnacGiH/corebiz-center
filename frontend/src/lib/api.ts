/**
 * Type-safe data access layer over Supabase.
 *
 * Pattern: each entity gets a small object of methods (list/get/create/update/remove).
 * All functions return promises that resolve to { data, error } where error is unwrapped
 * to a plain Error if non-null.
 */
import { supabase } from './supabase';
import type {
  Product, ProductInsert, ProductUpdate,
  Category, Warehouse,
  Inventory, InventoryInsert, InventoryUpdate,
  Customer, CustomerInsert, CustomerUpdate,
  CustomerBranch, CustomerBranchInsert, CustomerBranchUpdate,
  Order, OrderInsert, OrderUpdate,
  OrderItem,
  Notification,
  OrgSettings, OrgSettingsUpdate,
} from './database.types';

// =========================================================================
// Products + Inventory (joined view used by the Inventory page)
// =========================================================================
export interface ProductWithInventory extends Product {
  category: Pick<Category, 'id' | 'slug' | 'name_th' | 'name_en'> | null;
  inventory: Array<Pick<Inventory, 'id' | 'warehouse_id' | 'quantity' | 'reserved' | 'reorder_level' | 'shelf' | 'row_no'>>;
  /** Sum of quantity across all warehouses */
  total_quantity: number;
  /** True if at least one warehouse is below its reorder_level */
  low_stock: boolean;
}

/**
 * Compute the effective (after-discount) price of a product.
 *
 *   discount_type = 'percent' → price - price * (discount_value / 100)
 *   discount_type = 'fixed'   → price - discount_value
 *
 * Never returns negative; clamps to 0.
 */
export function getEffectivePrice(p: {
  price: number | string;
  discount_value?: number | string | null;
  discount_type?: string | null;
}): number {
  const base = Number(p.price ?? 0);
  const val = Number(p.discount_value ?? 0);
  if (!val) return base;
  const off = p.discount_type === 'percent' ? (base * val) / 100 : val;
  return Math.max(0, base - off);
}

export const productsApi = {
  async list(): Promise<ProductWithInventory[]> {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        category:categories(id,slug,name_th,name_en),
        inventory(id,warehouse_id,quantity,reserved,reorder_level,shelf,row_no)
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<Product & {
      category: ProductWithInventory['category'];
      inventory: ProductWithInventory['inventory'];
    }>;
    return rows.map(p => {
      const inv = p.inventory ?? [];
      const total = inv.reduce((acc, i) => acc + i.quantity, 0);
      const low = inv.some(i => i.quantity <= i.reorder_level);
      return { ...p, total_quantity: total, low_stock: low };
    });
  },

  async create(input: ProductInsert): Promise<Product> {
    const { data, error } = await supabase
      .from('products')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id: string, patch: ProductUpdate): Promise<Product> {
    const { data, error } = await supabase
      .from('products')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
  },
};

// =========================================================================
// Inventory
// =========================================================================
export const inventoryApi = {
  async upsert(input: InventoryInsert): Promise<Inventory> {
    const { data, error } = await supabase
      .from('inventory')
      .upsert(input, { onConflict: 'product_id,variant_id,warehouse_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async adjustQuantity(id: string, newQuantity: number): Promise<Inventory> {
    const patch: InventoryUpdate = { quantity: newQuantity };
    const { data, error } = await supabase
      .from('inventory')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// =========================================================================
// Categories
// =========================================================================
export const categoriesApi = {
  async list(): Promise<Category[]> {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
};

// =========================================================================
// Warehouses
// =========================================================================
export const warehousesApi = {
  async list(): Promise<Warehouse[]> {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_active', true)
      .order('is_default', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getDefault(): Promise<Warehouse> {
    const { data, error } = await supabase
      .from('warehouses')
      .select('*')
      .eq('is_default', true)
      .single();
    if (error) throw error;
    return data;
  },
};

// =========================================================================
// Customers
// =========================================================================
export const customersApi = {
  async list(): Promise<Customer[]> {
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('total_spent', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async create(input: CustomerInsert): Promise<Customer> {
    const { data, error } = await supabase
      .from('customers')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id: string, patch: CustomerUpdate): Promise<Customer> {
    const { data, error } = await supabase
      .from('customers')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) throw error;
  },
};

// =========================================================================
// Customer branches
// =========================================================================
export const customerBranchesApi = {
  /**
   * Fetch every branch row, ordered so consumers can `groupBy(customer_id)`
   * and get each customer's branches already in display order. Used by the
   * CRM page to render the small "branches under code" hint.
   */
  async listAll(): Promise<CustomerBranch[]> {
    const { data, error } = await supabase
      .from('customer_branches')
      .select('*')
      .order('customer_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('branch_code', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /** Fetch all branches that belong to one customer, ordered for display. */
  async listForCustomer(customerId: string): Promise<CustomerBranch[]> {
    const { data, error } = await supabase
      .from('customer_branches')
      .select('*')
      .eq('customer_id', customerId)
      .order('sort_order', { ascending: true })
      .order('branch_code', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async create(input: CustomerBranchInsert): Promise<CustomerBranch> {
    const { data, error } = await supabase
      .from('customer_branches')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id: string, patch: CustomerBranchUpdate): Promise<CustomerBranch> {
    const { data, error } = await supabase
      .from('customer_branches')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('customer_branches').delete().eq('id', id);
    if (error) throw error;
  },

  /**
   * Bulk-sync the branches of one customer:
   *   - rows in `desired` with no `id` → INSERT
   *   - rows in `desired` with an `id` matching an existing branch → UPDATE
   *   - existing branches whose `id` is not in `desired` → DELETE
   *
   * Returns the fresh list after sync.
   *
   * Done one-at-a-time over Promise.allSettled rather than via a single
   * upsert because we want clear per-row error reporting and the volumes are
   * small (typical customer has < 20 branches).
   */
  async syncForCustomer(
    customerId: string,
    desired: Array<Partial<CustomerBranchInsert> & { id?: string | null }>,
  ): Promise<CustomerBranch[]> {
    const existing = await this.listForCustomer(customerId);
    const desiredIds = new Set(desired.map((d) => d.id).filter(Boolean) as string[]);
    const toDelete = existing.filter((e) => !desiredIds.has(e.id));

    const tasks: Promise<unknown>[] = [];
    for (const d of desired) {
      const { id, ...rest } = d;
      // Normalise: branch_code + branch_name are required by the DB.
      if (!rest.branch_name || !rest.branch_code) continue;
      const payload: CustomerBranchInsert = {
        customer_id: customerId,
        branch_code: rest.branch_code,
        branch_name: rest.branch_name,
        address: rest.address ?? null,
        notes: rest.notes ?? null,
        sort_order: rest.sort_order ?? 0,
      };
      if (id) tasks.push(this.update(id, payload));
      else tasks.push(this.create(payload));
    }
    for (const b of toDelete) tasks.push(this.remove(b.id));

    const results = await Promise.allSettled(tasks);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      const first = failed[0] as PromiseRejectedResult;
      throw new Error(
        `บันทึกสาขาไม่สำเร็จ ${failed.length}/${tasks.length} รายการ — ${
          (first.reason as Error).message
        }`,
      );
    }

    return this.listForCustomer(customerId);
  },
};

// =========================================================================
// Orders
// =========================================================================
export interface OrderWithCustomer extends Order {
  customer: Pick<Customer, 'id' | 'name' | 'code' | 'tier'> | null;
  item_count?: number;
}

export const ordersApi = {
  async list(): Promise<OrderWithCustomer[]> {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        customer:customers(id,name,code,tier),
        items:order_items(count)
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<Order & {
      customer: OrderWithCustomer['customer'];
      items: Array<{ count: number }> | null;
    }>;
    return rows.map(o => ({
      ...o,
      item_count: Array.isArray(o.items) && o.items[0] ? o.items[0].count : 0,
    }));
  },

  async getById(id: string): Promise<{ order: OrderWithCustomer; items: OrderItem[] }> {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*, customer:customers(id,name,code,tier)')
      .eq('id', id)
      .single();
    if (orderErr) throw orderErr;

    const { data: items, error: itemsErr } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', id)
      .order('created_at', { ascending: true });
    if (itemsErr) throw itemsErr;

    return { order: order as unknown as OrderWithCustomer, items: items ?? [] };
  },

  async updateStatus(id: string, status: Order['status']): Promise<Order> {
    const patch: OrderUpdate = { status };
    const { data, error } = await supabase
      .from('orders')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async create(input: OrderInsert): Promise<Order> {
    const { data, error } = await supabase
      .from('orders')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

// =========================================================================
// Quotes (ใบเสนอราคา)
// =========================================================================
export interface QuoteDraftItem {
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
}

export const quotesApi = {
  /**
   * Create a quote with items in one go.
   * Generates a unique code: QT-YYYYMMDD-XXXX
   */
  async createWithItems(input: {
    customer_id?: string | null;
    items: QuoteDraftItem[];
    vat_rate?: number;       // 0.07 default
    valid_days?: number;     // 30 default
    notes?: string;
  }): Promise<{ id: string; code: string }> {
    const vat_rate = input.vat_rate ?? 0.07;
    const valid_days = input.valid_days ?? 30;

    const subtotal = input.items.reduce((acc, it) =>
      acc + (it.unit_price * it.quantity) - (it.discount ?? 0), 0);
    const vat = Math.round(subtotal * vat_rate * 100) / 100;
    const total = subtotal + vat;

    const code = `QT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${
      String(Math.floor(Math.random() * 9000) + 1000)
    }`;
    const valid_until = new Date(Date.now() + valid_days * 86400000).toISOString().slice(0, 10);

    const { data: quote, error: qErr } = await supabase
      .from('quotes')
      .insert({
        code,
        customer_id: input.customer_id ?? null,
        status: 'draft',
        subtotal,
        vat,
        total,
        valid_until,
        notes: input.notes ?? null,
      })
      .select('id, code')
      .single();
    if (qErr) throw qErr;

    const rows = input.items.map(it => ({
      quote_id: quote.id,
      product_id: it.product_id,
      sku: it.sku,
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount: it.discount ?? 0,
      total: it.unit_price * it.quantity - (it.discount ?? 0),
    }));

    const { error: iErr } = await supabase.from('quote_items').insert(rows);
    if (iErr) throw iErr;

    return quote;
  },
};

// =========================================================================
// Dashboard aggregates
// =========================================================================
export interface DashboardKPI {
  total_revenue: number;       // sum(orders.total) where payment_status='paid' and status not in cancelled/returned
  active_orders: number;       // count where status in (pending, processing, shipped)
  low_stock_count: number;     // products with at least one inventory below reorder_level
  new_customers_30d: number;   // customers created in last 30 days
  revenue_delta_pct: number;   // vs previous 30-day period
}

export interface MonthlyRevenue {
  month: string;               // 'YYYY-MM'
  revenue: number;
}

export interface ActivityEvent {
  id: string;
  type: 'order' | 'customer' | 'inventory' | 'system';
  message: string;
  created_at: string;
}

export const dashboardApi = {
  async getKPI(): Promise<DashboardKPI> {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
    const d60 = new Date(now.getTime() - 60 * 86400000).toISOString();

    // Total revenue (all-time paid)
    const { data: revRows, error: revErr } = await supabase
      .from('orders')
      .select('total, payment_status, status, created_at');
    if (revErr) throw revErr;

    const allRevenue = (revRows ?? [])
      .filter(r => r.payment_status === 'paid' && !['cancelled', 'returned'].includes(r.status))
      .reduce((acc, r) => acc + Number(r.total), 0);

    const rev30 = (revRows ?? [])
      .filter(r => r.payment_status === 'paid' && !['cancelled', 'returned'].includes(r.status))
      .filter(r => r.created_at >= d30)
      .reduce((acc, r) => acc + Number(r.total), 0);
    const rev30prev = (revRows ?? [])
      .filter(r => r.payment_status === 'paid' && !['cancelled', 'returned'].includes(r.status))
      .filter(r => r.created_at >= d60 && r.created_at < d30)
      .reduce((acc, r) => acc + Number(r.total), 0);

    const revenue_delta_pct = rev30prev > 0
      ? ((rev30 - rev30prev) / rev30prev) * 100
      : (rev30 > 0 ? 100 : 0);

    // Active orders
    const activeCount = (revRows ?? [])
      .filter(r => ['pending', 'processing', 'shipped'].includes(r.status))
      .length;

    // Low stock — query distinct products with any inventory <= reorder_level
    const { data: lowStockRows, error: lsErr } = await supabase
      .from('inventory')
      .select('product_id, quantity, reorder_level');
    if (lsErr) throw lsErr;

    const lowProducts = new Set<string>();
    for (const inv of lowStockRows ?? []) {
      if (inv.quantity <= inv.reorder_level) lowProducts.add(inv.product_id);
    }

    // New customers in last 30 days
    const { count: newCustCount, error: ncErr } = await supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', d30);
    if (ncErr) throw ncErr;

    return {
      total_revenue: allRevenue,
      active_orders: activeCount,
      low_stock_count: lowProducts.size,
      new_customers_30d: newCustCount ?? 0,
      revenue_delta_pct,
    };
  },

  /**
   * Returns last 7 months of revenue (including current).
   */
  async getMonthlyRevenue(months = 7): Promise<MonthlyRevenue[]> {
    const start = new Date();
    start.setDate(1);
    start.setMonth(start.getMonth() - (months - 1));
    start.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('orders')
      .select('total, payment_status, status, created_at')
      .gte('created_at', start.toISOString());
    if (error) throw error;

    const buckets: Record<string, number> = {};
    for (let i = 0; i < months; i++) {
      const d = new Date(start);
      d.setMonth(start.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets[key] = 0;
    }

    for (const r of data ?? []) {
      if (r.payment_status !== 'paid') continue;
      if (['cancelled', 'returned'].includes(r.status)) continue;
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (buckets[key] !== undefined) buckets[key] += Number(r.total);
    }

    return Object.entries(buckets).map(([month, revenue]) => ({ month, revenue }));
  },

  async getRecentActivity(limit = 10): Promise<ActivityEvent[]> {
    const events: ActivityEvent[] = [];

    // Recent orders
    const { data: orderRows } = await supabase
      .from('orders')
      .select('id, code, status, total, created_at, customer:customers(name)')
      .order('created_at', { ascending: false })
      .limit(limit);

    for (const o of (orderRows ?? []) as unknown as Array<{
      id: string; code: string; status: string; total: number; created_at: string;
      customer: { name: string } | null;
    }>) {
      events.push({
        id: `order-${o.id}`,
        type: 'order',
        message: `${o.code} ${o.customer?.name ?? ''} — ${o.status} ฿${Number(o.total).toLocaleString()}`,
        created_at: o.created_at,
      });
    }

    // Recent new customers
    const { data: custRows } = await supabase
      .from('customers')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    for (const c of custRows ?? []) {
      events.push({
        id: `cust-${c.id}`,
        type: 'customer',
        message: `ลูกค้าใหม่: ${c.name}`,
        created_at: c.created_at,
      });
    }

    return events
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
  },
};

// =========================================================================
// Quotes — list, getById (for PDF)
// =========================================================================
export interface QuoteListItem {
  id: string;
  code: string;
  status: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  customer: { id: string; name: string; tax_id: string | null; billing_address: unknown } | null;
}

export interface QuoteItem {
  id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  total: number;
}

export const quoteRecordApi = {
  async list(): Promise<QuoteListItem[]> {
    const { data, error } = await supabase
      .from('quotes')
      .select(`
        id,code,status,subtotal,discount,vat,total,valid_until,notes,created_at,
        customer:customers(id,name,tax_id,billing_address)
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as QuoteListItem[];
  },

  async getWithItems(id: string): Promise<{ quote: QuoteListItem; items: QuoteItem[] }> {
    const [{ data: quote, error: qErr }, { data: items, error: iErr }] = await Promise.all([
      supabase.from('quotes')
        .select(`id,code,status,subtotal,discount,vat,total,valid_until,notes,created_at,
          customer:customers(id,name,tax_id,billing_address)`)
        .eq('id', id).single(),
      supabase.from('quote_items')
        .select('id,sku,product_name,quantity,unit_price,discount,total')
        .eq('quote_id', id),
    ]);
    if (qErr) throw qErr;
    if (iErr) throw iErr;
    return { quote: quote as unknown as QuoteListItem, items: (items ?? []) as QuoteItem[] };
  },
};

// =========================================================================
// Campaigns + Coupons
// =========================================================================
export interface Campaign {
  id: string;
  name: string;
  type: 'promotion'|'flash_sale'|'popup'|'abandoned_cart'|'email'|'sms'|'banner';
  status: 'draft'|'scheduled'|'running'|'paused'|'completed'|'cancelled';
  starts_at: string | null;
  ends_at: string | null;
  config: Record<string, unknown>;
  metrics: { impressions?: number; clicks?: number; conversions?: number; revenue?: number };
  description: string | null;
  created_at: string;
}

export const campaignsApi = {
  async list(): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Campaign[];
  },

  async create(input: Partial<Campaign> & { name: string; type: Campaign['type'] }): Promise<Campaign> {
    const { data, error } = await supabase
      .from('campaigns')
      .insert(input as unknown as { name: string })
      .select()
      .single();
    if (error) throw error;
    return data as unknown as Campaign;
  },

  async updateStatus(id: string, status: Campaign['status']): Promise<void> {
    const { error } = await supabase.from('campaigns').update({ status } as never).eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('campaigns').delete().eq('id', id);
    if (error) throw error;
  },
};

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percent'|'fixed'|'free_shipping';
  discount_value: number;
  min_purchase: number;
  max_uses: number | null;
  used_count: number;
  valid_from: string | null;
  valid_until: string | null;
  status: 'active'|'inactive'|'expired'|'used_up';
}

export const couponsApi = {
  async list(): Promise<Coupon[]> {
    const { data, error } = await supabase
      .from('coupons')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Coupon[];
  },
};

// =========================================================================
// Omni-chat
// =========================================================================
export interface ChatConversation {
  id: string;
  channel: 'line'|'messenger'|'instagram'|'whatsapp'|'livechat'|'email';
  display_name: string;
  avatar_url: string | null;
  status: 'open'|'assigned'|'resolved'|'archived';
  tags: string[];
  sentiment: 'positive'|'neutral'|'negative' | null;
  unread_count: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_type: 'customer'|'agent'|'bot'|'system';
  sender_name: string | null;
  content: string;
  content_type: 'text'|'image'|'sticker'|'file'|'quick_reply'|'template';
  created_at: string;
}

export const chatApi = {
  async listConversations(): Promise<ChatConversation[]> {
    const { data, error } = await supabase
      .from('chat_conversations')
      .select('id,channel,display_name,avatar_url,status,tags,sentiment,unread_count,last_message_preview,last_message_at,created_at')
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return (data ?? []) as unknown as ChatConversation[];
  },

  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id,conversation_id,sender_type,sender_name,content,content_type,created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as ChatMessage[];
  },

  async sendMessage(conversationId: string, content: string, senderName: string): Promise<void> {
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      sender_name: senderName,
      content,
      content_type: 'text',
    } as never);
    if (error) throw error;
  },

  async markRead(conversationId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_conversations')
      .update({ unread_count: 0 } as never)
      .eq('id', conversationId);
    if (error) throw error;
  },
};

// =========================================================================
// Affiliate / Agents
// =========================================================================
export interface Agent {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  commission_rate: number;
  tier: 'starter'|'silver'|'gold'|'platinum';
  status: 'pending'|'active'|'suspended';
  total_clicks: number;
  total_conversions: number;
  total_sales: number;
  total_commission: number;
  pending_commission: number;
  joined_at: string;
  approved_at: string | null;
}

export interface AgentLink {
  id: string;
  agent_id: string;
  short_code: string;
  label: string | null;
  destination_url: string;
  clicks: number;
  conversions: number;
  revenue: number;
  is_active: boolean;
  created_at: string;
}

export const agentsApi = {
  async list(): Promise<Agent[]> {
    const { data, error } = await supabase
      .from('agents')
      .select('*')
      .order('total_sales', { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as Agent[];
  },

  async approve(id: string): Promise<void> {
    const { error } = await supabase
      .from('agents')
      .update({ status: 'active', approved_at: new Date().toISOString() } as never)
      .eq('id', id);
    if (error) throw error;
  },

  async suspend(id: string): Promise<void> {
    const { error } = await supabase.from('agents').update({ status: 'suspended' } as never).eq('id', id);
    if (error) throw error;
  },

  async listLinks(agentId?: string): Promise<AgentLink[]> {
    let q = supabase.from('agent_links').select('*').order('created_at', { ascending: false });
    if (agentId) q = q.eq('agent_id', agentId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as unknown as AgentLink[];
  },

  async createLink(input: { agent_id: string; label: string; destination_url: string }): Promise<AgentLink> {
    const short_code = `R${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { data, error } = await supabase
      .from('agent_links')
      .insert({ ...input, short_code } as never)
      .select()
      .single();
    if (error) throw error;
    return data as unknown as AgentLink;
  },
};

// =========================================================================
// RAG knowledge search (via edge function)
// =========================================================================
export interface KnowledgeMatch {
  id: string;
  title: string | null;
  content: string;
  source_path: string;
  metadata: Record<string, unknown>;
  tags: string[];
  similarity: number;
}

// =========================================================================
// Knowledge admin — list / add / delete chunks
// =========================================================================
export interface KnowledgeChunkRow {
  id: string;
  source_path: string;
  source_type: 'obsidian'|'manual'|'upload'|'crawl';
  title: string | null;
  content: string;
  language: string;
  chunk_index: number;
  visibility: 'public'|'internal';
  tags: string[];
  token_count: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSource {
  source_path: string;
  source_type: string;
  title: string | null;
  chunks_count: number;
  total_tokens: number;
  language: string;
  visibility: string;
  tags: string[];
  updated_at: string;
}

// =========================================================================
// Knowledge Chat (RAG + LLM via rag-chat Edge Function)
// =========================================================================
export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface RagChatSource {
  id: string;
  title: string | null;
  source_path: string;
  similarity: number;
  tags: string[];
  content_preview: string;
}

export interface RagChatResponse {
  answer: string;
  sources: RagChatSource[];
  tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  elapsed_ms: { embed: number; search: number; llm: number };
  model: string;
}

export const knowledgeChatApi = {
  async ask(input: {
    query: string;
    history?: ChatHistoryItem[];
    matchCount?: number;
    threshold?: number;
    model?: string;
    language?: 'th' | 'en' | 'mixed' | null;
  }): Promise<RagChatResponse> {
    const { data, error } = await supabase.functions.invoke('rag-chat', {
      body: {
        query: input.query,
        history: input.history ?? [],
        match_count: input.matchCount ?? 5,
        match_threshold: input.threshold ?? 0.4,
        model: input.model,
        language: input.language ?? null,
      },
    });
    if (error) throw error;
    return data as RagChatResponse;
  },
};

export const knowledgeAdminApi = {
  /** List chunks grouped by source_path. */
  async listSources(): Promise<KnowledgeSource[]> {
    const { data, error } = await supabase
      .from('knowledge_chunks')
      .select('source_path,source_type,title,language,visibility,tags,token_count,updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const rows = (data ?? []) as Array<Pick<KnowledgeChunkRow, 'source_path'|'source_type'|'title'|'language'|'visibility'|'tags'|'token_count'|'updated_at'>>;
    const grouped = new Map<string, KnowledgeSource>();
    for (const r of rows) {
      const existing = grouped.get(r.source_path);
      if (existing) {
        existing.chunks_count += 1;
        existing.total_tokens += r.token_count ?? 0;
        if (r.updated_at > existing.updated_at) existing.updated_at = r.updated_at;
      } else {
        grouped.set(r.source_path, {
          source_path: r.source_path,
          source_type: r.source_type,
          title: r.title,
          chunks_count: 1,
          total_tokens: r.token_count ?? 0,
          language: r.language,
          visibility: r.visibility,
          tags: r.tags,
          updated_at: r.updated_at,
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },

  async listChunksForSource(source_path: string): Promise<KnowledgeChunkRow[]> {
    const { data, error } = await supabase
      .from('knowledge_chunks')
      .select('id,source_path,source_type,title,content,language,chunk_index,visibility,tags,token_count,metadata,created_at,updated_at')
      .eq('source_path', source_path)
      .order('chunk_index', { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as KnowledgeChunkRow[];
  },

  async deleteSource(source_path: string): Promise<void> {
    const { error } = await supabase
      .from('knowledge_chunks')
      .delete()
      .eq('source_path', source_path);
    if (error) throw error;
  },

  /** Call add-knowledge edge function — chunks + embeds + inserts. */
  async addManual(input: {
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    language?: 'th' | 'en' | 'mixed';
    visibility?: 'public' | 'internal';
  }): Promise<{ source_path: string; chunks_count: number }> {
    const { data, error } = await supabase.functions.invoke('add-knowledge', {
      body: input,
    });
    if (error) throw error;
    return data as { source_path: string; chunks_count: number };
  },
};

export const knowledgeApi = {
  /**
   * Call edge function `rag-search` — handles Phaya embedding + match_knowledge() internally.
   */
  async ask(query: string, options: {
    matchCount?: number;
    threshold?: number;
    language?: 'th'|'en'|'mixed' | null;
  } = {}): Promise<{ matches: KnowledgeMatch[]; embed_ms: number; search_ms: number }> {
    const { data, error } = await supabase.functions.invoke('rag-search', {
      body: {
        query,
        match_count: options.matchCount ?? 5,
        match_threshold: options.threshold ?? 0.45,
        language: options.language ?? null,
      },
    });
    if (error) throw error;
    return data as { matches: KnowledgeMatch[]; embed_ms: number; search_ms: number };
  },

  /**
   * Direct RPC call (assumes caller already has the embedding).
   */
  async search(queryEmbedding: number[], options: {
    threshold?: number;
    limit?: number;
    language?: 'th'|'en'|'mixed' | null;
    visibility?: 'public'|'internal' | null;
  } = {}): Promise<KnowledgeMatch[]> {
    const { data, error } = await supabase.rpc('match_knowledge', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: options.threshold ?? 0.6,
      match_count: options.limit ?? 5,
      filter_language: options.language ?? undefined,
      filter_visibility: options.visibility ?? 'public',
    });
    if (error) throw error;
    return (data ?? []) as KnowledgeMatch[];
  },
};

// =========================================================================
// Notifications
// =========================================================================
export const notificationsApi = {
  /** List most recent notifications visible to the current staff user. */
  async list(limit = 50): Promise<Notification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as Notification[];
  },

  /** Mark a single notification as read. */
  async markRead(id: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id)
      .is('read_at', null);
    if (error) throw error;
  },

  /** Mark every currently-unread notification as read. */
  async markAllRead(): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null);
    if (error) throw error;
  },
};

// =========================================================================
// Org settings (singleton row in `org_settings`, id=true)
// =========================================================================
export const orgSettingsApi = {
  /** Read the singleton org_settings row. */
  async get(): Promise<OrgSettings | null> {
    const { data, error } = await supabase
      .from('org_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle();
    if (error) throw error;
    return (data as OrgSettings | null) ?? null;
  },

  /** Update the singleton row. Only fields in the patch are touched. */
  async update(patch: OrgSettingsUpdate): Promise<OrgSettings> {
    const { data, error } = await supabase
      .from('org_settings')
      .update(patch)
      .eq('id', true)
      .select()
      .single();
    if (error) throw error;
    return data as OrgSettings;
  },
};
