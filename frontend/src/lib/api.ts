/**
 * Type-safe data access layer over Supabase.
 *
 * Pattern: each entity gets a small object of methods (list/get/create/update/remove).
 * All functions return promises that resolve to { data, error } where error is unwrapped
 * to a plain Error if non-null.
 */
import { supabase } from './supabase';
import type { AppRole } from './supabase';
import type {
  Product, ProductInsert, ProductUpdate,
  ProductGroup, ProductGroupInsert, ProductGroupUpdate,
  Category, Warehouse,
  Inventory, InventoryInsert, InventoryUpdate,
  Customer, CustomerInsert, CustomerUpdate,
  CustomerBranch, CustomerBranchInsert, CustomerBranchUpdate,
  Order, OrderInsert, OrderUpdate,
  OrderItem,
  Quote, LoyaltyTransaction,
  Notification,
  OrgSettings, OrgSettingsUpdate,
} from './database.types';

// Re-export commonly-used row types so UI components can import them from the
// api module alongside its helpers (e.g. type Customer for the quote picker).
export type { Customer } from './database.types';

// =========================================================================
// Products + Inventory (joined view used by the Inventory page)
// =========================================================================
export interface ProductWithInventory extends Product {
  category: Pick<Category, 'id' | 'slug' | 'name_th' | 'name_en'> | null;
  /** Embedded group info, if the product was assigned to one. */
  group: Pick<ProductGroup, 'id' | 'name' | 'cover_image' | 'description'> | null;
  inventory: Array<Pick<Inventory, 'id' | 'warehouse_id' | 'quantity' | 'reserved' | 'reorder_level' | 'shelf' | 'row_no' | 'last_synced_at'>>;
  /** Sum of quantity across all warehouses */
  total_quantity: number;
  /** True if at least one warehouse is below its reorder_level */
  low_stock: boolean;
  /** Most recent last_synced_at across the product's inventory rows, if any. */
  last_synced_at: string | null;
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
        group:product_groups(id,name,cover_image,description),
        inventory(id,warehouse_id,quantity,reserved,reorder_level,shelf,row_no,last_synced_at)
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<Product & {
      category: ProductWithInventory['category'];
      group: ProductWithInventory['group'];
      inventory: ProductWithInventory['inventory'];
    }>;
    return rows.map(p => {
      const inv = p.inventory ?? [];
      const total = inv.reduce((acc, i) => acc + i.quantity, 0);
      const low = inv.some(i => i.quantity <= i.reorder_level);
      // Find the freshest sync timestamp across this product's inventory rows.
      // Sheet sync updates the default-warehouse row only, but if a product
      // has multiple warehouses the latest-synced one is what we surface.
      const synced = inv
        .map((i) => i.last_synced_at)
        .filter((t): t is string => !!t)
        .sort()
        .at(-1) ?? null;
      return { ...p, total_quantity: total, low_stock: low, last_synced_at: synced };
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
    const { data, error } = await supabase.from('products').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ลบสินค้านี้ — เฉพาะ Owner/Admin');
  },

  /** Apply the same `patch` to many products in a single round trip. Used by
   *  the Inventory bulk-edit modal — admin picks which fields to overwrite,
   *  enters new values, and they're set identically on every selected SKU.
   *
   *  Caller MUST NOT include `sku` or `id` in the patch — both are unique
   *  per row and bulk-overwriting them would produce duplicate-key errors. */
  async bulkUpdate(ids: string[], patch: ProductUpdate): Promise<number> {
    if (ids.length === 0) return 0;
    if ('sku' in patch || 'id' in patch) {
      throw new Error('bulkUpdate: sku and id cannot be bulk-edited (must be unique per product)');
    }
    if (Object.keys(patch).length === 0) {
      throw new Error('bulkUpdate: no fields to update');
    }
    const { error, count } = await supabase
      .from('products')
      .update(patch, { count: 'exact' })
      .in('id', ids);
    if (error) throw error;
    return count ?? 0;
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
// Product Groups — folders that bundle variant SKUs (e.g. all grit numbers
// of the same MIRKA GOLD line). Distinct from `categories` (งานขัด/etc).
// =========================================================================
export type { ProductGroup, ProductGroupInsert, ProductGroupUpdate };

export interface ProductGroupWithStats extends ProductGroup {
  member_count: number;
  /** Aggregate stock across all member products (sum of inventory.quantity). */
  total_stock: number;
}

export const productGroupsApi = {
  /** All groups ordered by sort_order. Includes a quick member count. */
  async list(): Promise<ProductGroupWithStats[]> {
    const { data, error } = await supabase
      .from('product_groups')
      .select(`
        id, name, description, cover_image, sort_order, is_active,
        created_at, updated_at,
        products(id)
      `)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    // PostgREST resolves the implicit FK relationship via products.group_id.
    // TS doesn't know the relation yet (generated types haven't been pulled),
    // so we cast through unknown.
    const rows = (data ?? []) as unknown as Array<
      ProductGroup & { products: Array<{ id: string }> }
    >;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      cover_image: r.cover_image,
      sort_order: r.sort_order,
      is_active: r.is_active,
      created_at: r.created_at,
      updated_at: r.updated_at,
      member_count: (r.products ?? []).length,
      total_stock: 0, // populated on detail view, not on list
    }));
  },

  /** Single group + the SKUs assigned to it. */
  async getWithMembers(id: string): Promise<{ group: ProductGroup; members: Product[] }> {
    const [{ data: g, error: gErr }, { data: m, error: mErr }] = await Promise.all([
      supabase.from('product_groups').select('*').eq('id', id).single(),
      supabase.from('products').select('*').eq('group_id', id).order('name_th', { ascending: true }),
    ]);
    if (gErr) throw gErr;
    if (mErr) throw mErr;
    return {
      group: g as ProductGroup,
      members: (m ?? []) as Product[],
    };
  },

  async create(input: { name: string; description?: string; cover_image?: string; sort_order?: number }): Promise<ProductGroup> {
    const payload: ProductGroupInsert = {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      cover_image: input.cover_image?.trim() || null,
      sort_order: input.sort_order ?? 0,
    };
    const { data, error } = await supabase
      .from('product_groups')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data as ProductGroup;
  },

  async update(id: string, patch: ProductGroupUpdate): Promise<ProductGroup> {
    const { data, error } = await supabase
      .from('product_groups')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as ProductGroup;
  },

  /** Hard-delete the group; products in it have their group_id reset to NULL (ON DELETE SET NULL). */
  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('product_groups').delete().eq('id', id);
    if (error) throw error;
  },

  /**
   * Bulk-assign a set of product ids into the given group. Pass group_id=null
   * to remove the assignment (unassign back to "ungrouped").
   */
  async assignProducts(group_id: string | null, product_ids: string[]): Promise<number> {
    if (product_ids.length === 0) return 0;
    const { error, count } = await supabase
      .from('products')
      .update({ group_id } as never, { count: 'exact' })
      .in('id', product_ids);
    if (error) throw error;
    return count ?? product_ids.length;
  },

  /**
   * Upload a cover image into the `product-groups` storage bucket and return
   * its public URL. File is renamed to `<groupId>-<timestamp>.<ext>` so
   * re-uploads don't collide and old images can be safely cleaned up later.
   */
  async uploadCover(groupId: string, file: File): Promise<string> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
    const path = `${groupId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('product-groups')
      .upload(path, file, { upsert: true, cacheControl: '3600' });
    if (error) throw error;
    const { data } = supabase.storage.from('product-groups').getPublicUrl(path);
    return data.publicUrl;
  },
};

// =========================================================================
// Inventory sync (Google Sheet → DB)
// =========================================================================
export interface InventorySyncLog {
  id: string;
  started_at: string;
  finished_at: string | null;
  source: string;
  sheet_rows: number;
  matched: number;
  updated: number;
  skipped: number;
  status: string;
  error: string | null;
}

export const inventorySyncApi = {
  /**
   * Fire a manual sync. Returns the pg_net request id (informational —
   * the actual sync runs async in an Edge Function; poll `latestLog()`
   * to see the result).
   */
  async triggerManual(): Promise<number> {
    const { data, error } = await supabase.rpc('trigger_inventory_sync');
    if (error) throw error;
    return Number(data ?? 0);
  },

  async latestLog(): Promise<InventorySyncLog | null> {
    const { data, error } = await supabase
      .from('inventory_sync_logs')
      .select('id, started_at, finished_at, source, sheet_rows, matched, updated, skipped, status, error')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  },

  /** Recent sync runs, newest first. Default cap: 50 — plenty for a UI list. */
  async listLogs(limit = 50): Promise<InventorySyncLog[]> {
    const { data, error } = await supabase
      .from('inventory_sync_logs')
      .select('id, started_at, finished_at, source, sheet_rows, matched, updated, skipped, status, error')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },
};

// =========================================================================
// Customers
// =========================================================================
export const customersApi = {
  /** Fetch ALL customers. PostgREST caps a single request at 1000 rows, so we
   *  page through in batches — otherwise the list (and the KPI cards derived
   *  from it) silently truncate at 1000. */
  async list(): Promise<Customer[]> {
    const PAGE = 1000;
    const all: Customer[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('total_spent', { ascending: false })
        .order('id', { ascending: true }) // stable tiebreaker — avoids dup/missed rows across pages
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const batch = data ?? [];
      all.push(...batch);
      if (batch.length < PAGE) break;
    }
    return all;
  },

  /** Lightweight server-side search for pickers — matches name / code /
   *  phone / mobile / tax id / contact name. Avoids pulling the whole
   *  3k-row customer list into a dropdown. */
  async search(term: string, limit = 30): Promise<Customer[]> {
    const t = term.trim().replace(/[,()*]/g, ' ').trim();
    if (!t) return [];
    const { data, error } = await supabase
      .from('customers')
      .select('id,code,name,tier,phone,mobile,tax_id,contact_name,billing_address')
      .or(
        `name.ilike.*${t}*,code.ilike.*${t}*,phone.ilike.*${t}*,mobile.ilike.*${t}*,tax_id.ilike.*${t}*,contact_name.ilike.*${t}*`,
      )
      .order('total_spent', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as unknown as Customer[];
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

  /** Bulk insert-or-update, conflict-keyed on `code` (idempotent — safe to
   *  re-run). De-dupes codeful rows within the batch (last wins) so a repeated
   *  code in one statement can't error; codeless rows always insert. */
  async bulkUpsert(rows: CustomerInsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    const byCode = new Map<string, CustomerInsert>();
    const codeless: CustomerInsert[] = [];
    for (const r of rows) {
      const code = (r.code ?? '').toString().trim();
      if (code) byCode.set(code, r);
      else codeless.push(r);
    }
    const batch = [...byCode.values(), ...codeless];
    const { error } = await supabase.from('customers').upsert(batch, { onConflict: 'code' });
    if (error) throw error;
    return batch.length;
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
    const { data, error } = await supabase.from('customers').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ลบลูกค้ารายนี้ — เฉพาะ Owner/Admin');
  },
};

// =========================================================================
// Customer RFM — Recency / Frequency / Monetary scores + segment.
// Backed by the `customer_rfm` view (migration 0017). Read-only.
// =========================================================================
export type RfmSegment =
  | 'champion'
  | 'loyal'
  | 'new'
  | 'cant_lose'
  | 'at_risk'
  | 'hibernating'
  | 'needs_attention'
  | 'prospect';

export interface CustomerRFM {
  id: string;
  code: string | null;
  name: string;
  contact_name: string | null;
  customer_type: string;
  tier: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  tags: string[];
  loyalty_points: number;
  created_at: string;
  /** ISO date of the last paid order, or null if never purchased. */
  last_purchase_at: string | null;
  /** Days since last paid order, or null. */
  recency_days: number | null;
  frequency: number;        // total paid orders
  monetary: number;         // total paid spend (฿)
  r_score: number;          // 0–5
  f_score: number;          // 0–5
  m_score: number;          // 0–5
  fm_score: number;         // rounded average of F & M
  segment: RfmSegment;
}

export const customerRfmApi = {
  /** RFM scores + segment for every customer (most valuable first). */
  async list(): Promise<CustomerRFM[]> {
    // `customer_rfm` is a read-only VIEW kept OUT of the generated Database
    // type — adding it there broke from() resolution for other relations. So
    // we query it through an untyped client handle and cast the result.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('customer_rfm')
      .select('*')
      .order('monetary', { ascending: false });
    if (error) throw error;
    return (data ?? []) as CustomerRFM[];
  },
};

// =========================================================================
// Customer 360° profile — one customer + all their linked history, fetched
// in parallel for the CRM profile drawer.
// =========================================================================
export interface CustomerProfileBundle {
  customer: Customer;
  rfm: CustomerRFM | null;
  orders: Order[];
  quotes: Quote[];
  loyalty: LoyaltyTransaction[];
  chats: ChatConversation[];
  branches: CustomerBranch[];
}

export const customerProfileApi = {
  async get(customerId: string): Promise<CustomerProfileBundle> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const [cRes, rfmRes, oRes, qRes, lRes, chRes, bRes] = await Promise.all([
      supabase.from('customers').select('*').eq('id', customerId).single(),
      db.from('customer_rfm').select('*').eq('id', customerId).maybeSingle(),
      supabase.from('orders').select('*').eq('customer_id', customerId)
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('quotes').select('*').eq('customer_id', customerId)
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('loyalty_transactions').select('*').eq('customer_id', customerId)
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('chat_conversations').select('*').eq('customer_id', customerId)
        .order('last_message_at', { ascending: false, nullsFirst: false }).limit(20),
      supabase.from('customer_branches').select('*').eq('customer_id', customerId)
        .order('sort_order', { ascending: true }),
    ]);
    if (cRes.error) throw cRes.error;
    return {
      customer: cRes.data as Customer,
      rfm: (rfmRes.data ?? null) as CustomerRFM | null,
      orders: (oRes.data ?? []) as Order[],
      quotes: (qRes.data ?? []) as Quote[],
      loyalty: (lRes.data ?? []) as LoyaltyTransaction[],
      chats: (chRes.data ?? []) as ChatConversation[],
      branches: (bRes.data ?? []) as CustomerBranch[],
    };
  },
};

// =========================================================================
// Loyalty points — manual adjust + redeem-for-coupon (Phase 1).
// Backed by the security-definer RPCs in migration 0018.
// =========================================================================
export const loyaltyApi = {
  /** Grant (+) or deduct (−) points manually. Returns the new balance. */
  async adjust(customerId: string, points: number, note?: string): Promise<number> {
    const { data, error } = await supabase.rpc('adjust_loyalty_points', {
      p_customer_id: customerId, p_points: points, p_note: note ?? null,
    });
    if (error) throw error;
    return data as number;
  },

  /** Redeem points for a single-use fixed-baht discount coupon. Returns the
   *  coupon code + the customer's new balance. */
  async redeem(
    customerId: string, points: number, discount: number, label?: string,
  ): Promise<{ coupon_code: string; new_balance: number }> {
    const { data, error } = await supabase.rpc('redeem_loyalty_points', {
      p_customer_id: customerId, p_points: points, p_discount: discount, p_label: label ?? null,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row as { coupon_code: string; new_balance: number };
  },
};

// =========================================================================
// Reorder reminders (Phase 1) — customers due to reorder consumables, nudged
// over their linked LINE chat. Backed by the reorder_due view (migration 0019).
// =========================================================================
export interface ReorderDue {
  id: string;
  code: string | null;
  name: string;
  tier: string;
  total_orders: number;
  total_spent: number;
  loyalty_points: number;
  last_reorder_reminder_at: string | null;
  last_purchase_at: string;
  recency_days: number;
  conversation_id: string;
  external_id: string;
}

/** Phase 4: forecast row — predicted reorder date from the learned purchase cycle. */
export interface ReorderForecast {
  id: string;
  code: string | null;
  name: string;
  tier: string;
  avg_cycle_days: number;
  paid_orders: number;
  last_purchase_at: string;
  predicted_due_at: string;
  days_until_due: number;        // negative = overdue
  last_reorder_reminder_at: string | null;
  conversation_id: string | null; // null if no LINE chat
  external_id: string | null;
  usual_items: string | null;
}

export const reorderApi = {
  /** Customers due for a reorder reminder, most overdue first. */
  async listDue(): Promise<ReorderDue[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('reorder_due')
      .select('*')
      .order('recency_days', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ReorderDue[];
  },

  /** Auto-reorder forecast: customers ranked by how due they are (most overdue
   *  first) based on their learned purchase cycle. */
  async listForecast(): Promise<ReorderForecast[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('reorder_forecast')
      .select('*')
      .order('days_until_due', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ReorderForecast[];
  },

  /** Send a reorder reminder: post it into the customer's LINE conversation
   *  (logs the message + pushes to LINE via the existing send path), then
   *  stamp the customer so they're not nudged again too soon. */
  async sendReminder(input: { customerId: string; conversationId: string; text: string }): Promise<void> {
    await chatInboxApi.sendMessage({ conversationId: input.conversationId, content: input.text });
    const { error } = await supabase
      .from('customers')
      .update({ last_reorder_reminder_at: new Date().toISOString() })
      .eq('id', input.customerId);
    if (error) throw error;
  },
};

// =========================================================================
// Win-back (Phase 2) — re-engage lapsed customers (>= 90d) over LINE, with an
// optional discount coupon. Backed by the winback_due view + issue_coupon RPC.
// =========================================================================
export interface WinbackDue {
  id: string;
  code: string | null;
  name: string;
  tier: string;
  total_orders: number;
  total_spent: number;
  loyalty_points: number;
  last_winback_at: string | null;
  last_purchase_at: string;
  recency_days: number;
  conversation_id: string;
  external_id: string;
}

export const winbackApi = {
  /** Lapsed customers due for a win-back, highest lifetime value first. */
  async listDue(): Promise<WinbackDue[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('winback_due')
      .select('*')
      .order('total_spent', { ascending: false });
    if (error) throw error;
    return (data ?? []) as WinbackDue[];
  },

  /** Send a win-back message. If `discount` > 0, mint a single-use coupon and
   *  append it to the message. Sends via the LINE conversation (logs to
   *  Omni-Chat + pushes to LINE) and stamps last_winback_at. */
  async send(input: {
    customerId: string; conversationId: string; text: string; discount?: number;
  }): Promise<{ coupon?: string }> {
    let coupon: string | undefined;
    let text = input.text;
    if (input.discount && input.discount > 0) {
      const { data, error } = await supabase.rpc('issue_coupon', {
        p_discount: input.discount, p_label: 'Win-back',
      });
      if (error) throw error;
      coupon = data as string;
      text += `\n\n🎁 ส่วนลดพิเศษสำหรับคุณ: ใช้โค้ด ${coupon} ลด ฿${input.discount} (ใช้ได้ 60 วัน)`;
    }
    await chatInboxApi.sendMessage({ conversationId: input.conversationId, content: text });
    const { error: upErr } = await supabase
      .from('customers')
      .update({ last_winback_at: new Date().toISOString() })
      .eq('id', input.customerId);
    if (upErr) throw upErr;
    return { coupon };
  },
};

// =========================================================================
// Quote follow-up (Phase 2, "กู้ตะกร้า") — chase open quotes that never became
// an order. Backed by the open_quotes view (migration 0021).
// =========================================================================
export interface OpenQuote {
  id: string;
  code: string;
  status: string;
  total: number;
  created_at: string;
  valid_until: string | null;
  last_followup_at: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  age_days: number;
  conversation_id: string | null;   // null if the quote's customer has no LINE chat
  external_id: string | null;
}

export const quoteFollowupApi = {
  /** Open (unconverted, non-draft/rejected) quotes — highest value first. */
  async listOpen(): Promise<OpenQuote[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('open_quotes')
      .select('*')
      .order('total', { ascending: false });
    if (error) throw error;
    return (data ?? []) as OpenQuote[];
  },

  /** Send a follow-up over the quote's customer LINE chat (logs to Omni-Chat +
   *  pushes to LINE), then stamp the quote so it's not chased again too soon. */
  async sendFollowup(input: { quoteId: string; conversationId: string; text: string }): Promise<void> {
    await chatInboxApi.sendMessage({ conversationId: input.conversationId, content: input.text });
    const { error } = await supabase
      .from('quotes')
      .update({ last_followup_at: new Date().toISOString() })
      .eq('id', input.quoteId);
    if (error) throw error;
  },
};

// =========================================================================
// Satisfaction surveys / NPS (Phase 3) — send a LINE survey link, customer
// rates on a public page (no login). Backed by migration 0022:
// survey_due view + create_survey (staff) + submit_survey (anon) RPCs.
// =========================================================================
export interface SurveyDue {
  id: string;
  code: string | null;
  name: string;
  tier: string;
  total_orders: number;
  total_spent: number;
  conversation_id: string;
  external_id: string;
  last_survey_at: string | null;
}

export interface SurveyResult {
  id: string;
  customer_id: string | null;
  conversation_id: string | null;
  type: string;
  score: number | null;
  comment: string | null;
  created_at: string;
  answered_at: string | null;
  customer_name: string | null;
  customer_code: string | null;
}

export const surveyApi = {
  /** Real customers (paid + LINE) due for a satisfaction survey, top value first. */
  async listDue(): Promise<SurveyDue[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('survey_due')
      .select('*')
      .order('total_spent', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SurveyDue[];
  },

  /** All surveys (answered + pending) with the customer name, newest first. */
  async listResults(limit = 200): Promise<SurveyResult[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('surveys')
      .select('*, customer:customers(name, code)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data ?? []) as any[]).map((r) => ({
      id: r.id,
      customer_id: r.customer_id,
      conversation_id: r.conversation_id,
      type: r.type,
      score: r.score,
      comment: r.comment,
      created_at: r.created_at,
      answered_at: r.answered_at,
      customer_name: r.customer?.name ?? null,
      customer_code: r.customer?.code ?? null,
    }));
  },

  /** Create a survey for the customer, append its rating link to `text`, and
   *  send it over their LINE chat (logs to Omni-Chat + pushes to LINE). */
  async createAndSend(input: { customerId: string; conversationId: string; text: string }): Promise<void> {
    const { data: token, error } = await supabase.rpc('create_survey', {
      p_customer_id: input.customerId,
      p_conversation_id: input.conversationId,
    });
    if (error) throw error;
    const link = `${window.location.origin}${import.meta.env.BASE_URL}survey/${token}`;
    const content = `${input.text}\n\n⭐ ให้คะแนนความพึงพอใจ (ใช้เวลาแค่ 30 วินาที): ${link}`;
    await chatInboxApi.sendMessage({ conversationId: input.conversationId, content });
  },

  /** Public (anon): record an answer by token. Returns false if already answered. */
  async submit(token: string, score: number, comment?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('submit_survey', {
      p_token: token,
      p_score: score,
      p_comment: comment ?? null,
    });
    if (error) throw error;
    return Boolean(data);
  },
};

// =========================================================================
// Tier privileges (Phase 4) — per-tier loyalty multiplier + standing discount,
// editable by staff. Backed by tier_benefits + customer_benefits + the
// grant_purchase_points RPC (migration 0024).
// =========================================================================
export interface TierBenefit {
  tier: string;
  label: string;
  sort_order: number;
  point_multiplier: number;
  discount_percent: number;
  min_spend: number;
  color: string;
}

export interface CustomerBenefit {
  id: string;
  tier: string;
  tier_label: string;
  point_multiplier: number;
  discount_percent: number;
  color: string;
}

export const tierApi = {
  /** All tiers with their benefits, lowest → highest. */
  async listBenefits(): Promise<TierBenefit[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.from('tier_benefits').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as TierBenefit[];
  },

  /** Update a tier's multiplier / discount (staff RLS). */
  async updateBenefit(tier: string, patch: { point_multiplier?: number; discount_percent?: number }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db.from('tier_benefits').update({ ...patch, updated_at: new Date().toISOString() }).eq('tier', tier);
    if (error) throw error;
  },

  /** A single customer's effective benefits (for the 360° profile). */
  async customerBenefit(customerId: string): Promise<CustomerBenefit | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.from('customer_benefits').select('*').eq('id', customerId).maybeSingle();
    if (error) throw error;
    return (data ?? null) as CustomerBenefit | null;
  },

  /** Grant purchase points with the customer's tier multiplier applied. */
  async grantPoints(customerId: string, amount: number, note?: string): Promise<{ points_granted: number; multiplier: number; new_balance: number }> {
    const { data, error } = await supabase.rpc('grant_purchase_points', { p_customer_id: customerId, p_amount: amount, p_note: note ?? null });
    if (error) throw error;
    return data as { points_granted: number; multiplier: number; new_balance: number };
  },

  /** Customers whose lifetime spend suggests a different tier than they're on. */
  async listSuggestions(): Promise<TierSuggestion[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.from('tier_suggestions').select('*').order('total_spent', { ascending: false });
    if (error) throw error;
    return (data ?? []) as TierSuggestion[];
  },

  /** Move a customer to a tier (staff). */
  async applyTier(customerId: string, tier: string): Promise<void> {
    const { error } = await supabase.rpc('apply_customer_tier', { p_customer_id: customerId, p_tier: tier });
    if (error) throw error;
  },
};

export interface TierSuggestion {
  id: string;
  code: string | null;
  name: string;
  current_tier: string;
  suggested_tier: string;
  total_spent: number;
  total_orders: number;
  loyalty_points: number;
  conversation_id: string | null;
  external_id: string | null;
}

// =========================================================================
// CRM dashboard (Phase 5) — one-call snapshot of customer health.
// =========================================================================
export interface DashboardStats {
  customers: { total: number; with_line: number; general: number; silver: number; gold: number; vip: number };
  orders: { paid_orders: number; revenue: number };
  repeat: { buyers: number; repeat_buyers: number; rate: number };
  nps: { responses: number; promoters: number; passives: number; detractors: number; score: number | null };
  loyalty: { points_outstanding: number };
  coupons: { active: number };
  referrals: { total: number; rewarded: number; pending: number };
  segments: { segment: string | null; count: number; value: number }[];
}

export const crmDashboardApi = {
  async stats(): Promise<DashboardStats> {
    const { data, error } = await supabase.rpc('crm_dashboard_stats');
    if (error) throw error;
    return data as unknown as DashboardStats;
  },
};

// =========================================================================
// Scheduled sends (Phase 5) — queue a LINE message for a future time; admin
// confirms the send when it's due. Backed by scheduled_messages (migration 0029).
// =========================================================================
export interface ScheduledMessage {
  id: string;
  customer_id: string | null;
  conversation_id: string;
  kind: 'custom' | 'campaign' | 'reorder' | 'promo';
  text: string;
  scheduled_at: string;
  status: 'pending' | 'sent' | 'cancelled';
  note: string | null;
  created_at: string;
  sent_at: string | null;
  customer_name: string | null;
  customer_code: string | null;
  is_due: boolean;
}

export const scheduleApi = {
  async listOverview(): Promise<ScheduledMessage[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db.from('scheduled_overview').select('*').order('scheduled_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ScheduledMessage[];
  },

  async create(input: { customerId: string | null; conversationId: string; text: string; scheduledAt: string; kind?: string }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db.from('scheduled_messages').insert({
      customer_id: input.customerId, conversation_id: input.conversationId,
      text: input.text, scheduled_at: input.scheduledAt, kind: input.kind ?? 'custom',
    });
    if (error) throw error;
  },

  async cancel(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', id);
    if (error) throw error;
  },

  /** Send a due scheduled message now (logs to Omni-Chat + LINE), mark sent. */
  async sendNow(item: ScheduledMessage): Promise<void> {
    await chatInboxApi.sendMessage({ conversationId: item.conversation_id, content: item.text });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db.from('scheduled_messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.id);
    if (error) throw error;
  },
};

// =========================================================================
// Referral program (Phase 3, "แนะนำเพื่อน") — customer-to-customer referrals.
// Each customer has a share code; a friend registers via the public /refer
// page; staff reward both sides. Backed by migration 0023.
// =========================================================================
export interface ReferralRow {
  id: string;
  referrer_id: string;
  referee_name: string;
  referee_phone: string | null;
  referee_customer_id: string | null;
  status: 'pending' | 'rewarded' | 'expired';
  referrer_points: number;
  referee_points: number;
  referrer_coupon: string | null;
  referee_coupon: string | null;
  source: 'staff' | 'public';
  note: string | null;
  created_at: string;
  rewarded_at: string | null;
  referrer_name: string | null;
  referrer_code: string | null;
  referrer_share_code: string | null;
  referee_customer_name: string | null;
}

export interface ReferralLeader {
  referrer_id: string;
  referrer_name: string | null;
  referrer_code: string | null;
  tier: string;
  total_referrals: number;
  rewarded_count: number;
  pending_count: number;
  points_earned: number;
}

export const referralApi = {
  /** All referrals (joined to referrer + referee names), newest first. */
  async listOverview(): Promise<ReferralRow[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('referral_overview')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ReferralRow[];
  },

  /** Get (or lazily create) a customer's stable share code. */
  async code(customerId: string): Promise<string> {
    const { data, error } = await supabase.rpc('get_or_create_referral_code', { p_customer_id: customerId });
    if (error) throw error;
    return data as string;
  },

  /** Staff: record a referral directly. */
  async create(input: { referrerId: string; refereeName: string; refereePhone?: string; note?: string }): Promise<string> {
    const { data, error } = await supabase.rpc('create_referral', {
      p_referrer_id: input.referrerId,
      p_referee_name: input.refereeName,
      p_referee_phone: input.refereePhone ?? null,
      p_note: input.note ?? null,
    });
    if (error) throw error;
    return data as string;
  },

  /** Top referrers leaderboard (most successful first). */
  async leaderboard(): Promise<ReferralLeader[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('referral_leaderboard')
      .select('*')
      .order('rewarded_count', { ascending: false })
      .order('total_referrals', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ReferralLeader[];
  },

  /** Link a referral to an existing customer record (the friend joined). */
  async linkCustomer(referralId: string, customerId: string): Promise<void> {
    const { error } = await supabase.rpc('link_referral_customer', { p_referral_id: referralId, p_customer_id: customerId });
    if (error) throw error;
  },

  /** Reward both sides: referrer points (+ optional coupon), friend coupon, and
   *  friend loyalty points (only credited if the friend is linked to a customer). */
  async reward(input: {
    referralId: string; referrerPoints: number; refereeDiscount: number; referrerDiscount?: number; refereePoints?: number;
  }): Promise<{ referrer_coupon: string | null; referee_coupon: string | null; referee_points: number }> {
    const { data, error } = await supabase.rpc('reward_referral', {
      p_referral_id: input.referralId,
      p_referrer_points: input.referrerPoints,
      p_referee_discount: input.refereeDiscount,
      p_referrer_discount: input.referrerDiscount ?? 0,
      p_referee_points: input.refereePoints ?? 0,
    });
    if (error) throw error;
    return (data ?? { referrer_coupon: null, referee_coupon: null, referee_points: 0 }) as {
      referrer_coupon: string | null; referee_coupon: string | null; referee_points: number;
    };
  },

  /** Public (anon): a friend registers using a referrer's share code. */
  async submit(code: string, refereeName: string, refereePhone?: string, note?: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('submit_referral', {
      p_code: code,
      p_referee_name: refereeName,
      p_referee_phone: refereePhone ?? null,
      p_note: note ?? null,
    });
    if (error) throw error;
    return Boolean(data);
  },
};

// =========================================================================
// Segment campaigns (Phase 4) — target a customer group by RFM segment / tier
// and send one-by-one (paced, human-like). Backed by campaign_recipients view.
// =========================================================================
export interface CampaignRecipient {
  id: string;
  code: string | null;
  name: string;
  tier: string;
  segment: string | null;
  recency_days: number | null;
  total_orders: number | null;
  total_spent: number | null;
  loyalty_points: number;
  conversation_id: string;
  external_id: string;
}

export const segmentCampaignApi = {
  /** All LINE-reachable customers with their RFM segment + tier (for targeting). */
  async listRecipients(): Promise<CampaignRecipient[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('campaign_recipients')
      .select('*')
      .order('total_spent', { ascending: false });
    if (error) throw error;
    return (data ?? []) as CampaignRecipient[];
  },

  /** Send one campaign message into a customer's LINE chat (logs to Omni-Chat). */
  async send(conversationId: string, text: string): Promise<void> {
    await chatInboxApi.sendMessage({ conversationId, content: text });
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
      .select('*, customer:customers(id,name,code,tier,tax_id,billing_address)')
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

  /** Replace an order's line items + bill-foot discount, recompute totals (keeps shipping_fee). */
  async updateItems(orderId: string, items: QuoteDraftItem[], discount = 0, shippingFee = 0): Promise<void> {
    const subtotal = items.reduce((a, it) => a + it.unit_price * it.quantity - (it.discount ?? 0), 0);
    const disc = Math.max(0, Math.round((discount || 0) * 100) / 100);
    const net = subtotal - disc;
    const vat = Math.round(net * 0.07 * 100) / 100;
    const total = net + vat + (Number(shippingFee) || 0);
    const { error: delErr } = await supabase.from('order_items').delete().eq('order_id', orderId);
    if (delErr) throw delErr;
    if (items.length > 0) {
      const rows = items.map((it) => ({
        order_id: orderId, product_id: it.product_id ?? null, variant_id: null, sku: it.sku, product_name: it.product_name,
        quantity: it.quantity, unit_price: it.unit_price, unit: it.unit ?? null, discount: it.discount ?? 0,
        total: it.unit_price * it.quantity - (it.discount ?? 0),
      }));
      const { error: insErr } = await supabase.from('order_items').insert(rows as never);
      if (insErr) throw insErr;
    }
    const { error: upErr } = await supabase.from('orders').update({ subtotal, discount: disc, vat, total } as never).eq('id', orderId);
    if (upErr) throw upErr;
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
  product_id?: string | null;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  /** Product unit label (ชิ้น / แพ็ค / …) shown next to the quantity on documents. */
  unit?: string | null;
}

export const quotesApi = {
  /**
   * Create a quote with items in one go.
   * Generates a unique code: QT-YYYYMMDD-XXXX
   */
  async createWithItems(input: {
    customer_id?: string | null;
    items: QuoteDraftItem[];
    discount?: number;       // whole-quote discount (e.g. member discount), shown at the bill foot
    vat_rate?: number;       // 0.07 default
    valid_days?: number;     // 30 default
    notes?: string;
  }): Promise<{ id: string; code: string }> {
    const vat_rate = input.vat_rate ?? 0.07;
    const valid_days = input.valid_days ?? 30;

    // Line items stay at full price; the discount is a single bill-foot line.
    const subtotal = input.items.reduce((acc, it) =>
      acc + (it.unit_price * it.quantity) - (it.discount ?? 0), 0);
    const discount = Math.max(0, Math.round((input.discount ?? 0) * 100) / 100);
    const net = subtotal - discount;
    const vat = Math.round(net * vat_rate * 100) / 100;
    const total = net + vat;

    // code is generated DB-side by a sequence default (QT-<8-digit running no.),
    // guaranteed unique — don't set it here.
    const valid_until = new Date(Date.now() + valid_days * 86400000).toISOString().slice(0, 10);

    const { data: quote, error: qErr } = await supabase
      .from('quotes')
      .insert({
        customer_id: input.customer_id ?? null,
        status: 'draft',
        subtotal,
        discount,
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
      unit: it.unit ?? null,
      discount: it.discount ?? 0,
      total: it.unit_price * it.quantity - (it.discount ?? 0),
    }));

    const { error: iErr } = await supabase.from('quote_items').insert(rows as never);
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
  converted_to_order_id: string | null;
  customer: { id: string; name: string; tax_id: string | null; billing_address: unknown } | null;
}

export interface QuoteItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit: string | null;
  discount: number;
  total: number;
}

export const quoteRecordApi = {
  async list(): Promise<QuoteListItem[]> {
    const { data, error } = await supabase
      .from('quotes')
      .select(`
        id,code,status,subtotal,discount,vat,total,valid_until,notes,created_at,
        converted_to_order_id,
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
          converted_to_order_id,
          customer:customers(id,name,tax_id,billing_address)`)
        .eq('id', id).single(),
      supabase.from('quote_items')
        .select('id,product_id,variant_id,sku,product_name,quantity,unit_price,unit,discount,total')
        .eq('quote_id', id),
    ]);
    if (qErr) throw qErr;
    if (iErr) throw iErr;
    return { quote: quote as unknown as QuoteListItem, items: (items ?? []) as QuoteItem[] };
  },

  /** Update a quote's lifecycle status — draft → sent → accepted/rejected/expired. */
  async updateStatus(id: string, status: string): Promise<void> {
    const { error } = await supabase
      .from('quotes')
      .update({ status } as never)
      .eq('id', id);
    if (error) throw error;
  },

  /** Link (or unlink) the quote to a customer — used by the admin to assign a
   *  real customer to a bot-created "ลูกค้าทั่วไป" quote before approving. */
  async setCustomer(quoteId: string, customerId: string | null): Promise<void> {
    const { error } = await supabase
      .from('quotes')
      .update({ customer_id: customerId } as never)
      .eq('id', quoteId);
    if (error) throw error;
  },

  /** Replace a quote's line items + bill-foot discount, recompute totals. */
  async updateItems(quoteId: string, items: QuoteDraftItem[], discount = 0): Promise<void> {
    const subtotal = items.reduce((a, it) => a + it.unit_price * it.quantity - (it.discount ?? 0), 0);
    const disc = Math.max(0, Math.round((discount || 0) * 100) / 100);
    const net = subtotal - disc;
    const vat = Math.round(net * 0.07 * 100) / 100;
    const total = net + vat;
    const { error: delErr } = await supabase.from('quote_items').delete().eq('quote_id', quoteId);
    if (delErr) throw delErr;
    if (items.length > 0) {
      const rows = items.map((it) => ({
        quote_id: quoteId, product_id: it.product_id ?? null, sku: it.sku, product_name: it.product_name,
        quantity: it.quantity, unit_price: it.unit_price, unit: it.unit ?? null, discount: it.discount ?? 0,
        total: it.unit_price * it.quantity - (it.discount ?? 0),
      }));
      const { error: insErr } = await supabase.from('quote_items').insert(rows as never);
      if (insErr) throw insErr;
    }
    const { error: upErr } = await supabase.from('quotes').update({ subtotal, discount: disc, vat, total } as never).eq('id', quoteId);
    if (upErr) throw upErr;
  },

  /** Permanently remove a quote (cascades to quote_items). */
  async remove(id: string): Promise<void> {
    const { data, error } = await supabase.from('quotes').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ลบใบเสนอราคานี้ — เฉพาะ Owner/Admin');
  },

  /**
   * Approve a quote → create an Order with status='processing' (กำลังเตรียม)
   * that copies all its line items — orders never start in 'pending', that
   * tab is for quotes. The quote's status flips to 'accepted' and its
   * `converted_to_order_id` points at the new order. Returns the new order's
   * id + code.
   *
   * Done client-side as a sequence of supabase calls (no RPC) — three writes,
   * each fast. If the order insert succeeds but the link-back update fails,
   * we don't roll back the order; the operator can re-run approve and the
   * idempotency check (already-accepted? has converted_to_order_id?) keeps
   * it safe.
   */
  async approveAsOrder(quoteId: string): Promise<{ id: string; code: string }> {
    // 1. Idempotency: if already accepted + linked, return the existing order.
    const { data: existing, error: exErr } = await supabase
      .from('quotes')
      .select('id, code, status, converted_to_order_id, customer_id, subtotal, discount, vat, total, notes')
      .eq('id', quoteId)
      .single();
    if (exErr) throw exErr;
    if (existing.status === 'accepted' && existing.converted_to_order_id) {
      const { data: alreadyOrder } = await supabase
        .from('orders')
        .select('id, code')
        .eq('id', existing.converted_to_order_id)
        .maybeSingle();
      if (alreadyOrder) return alreadyOrder as { id: string; code: string };
    }

    // 2. Load the quote's items (we need them to mirror as order_items).
    const { data: qItems, error: qiErr } = await supabase
      .from('quote_items')
      .select('product_id,variant_id,sku,product_name,quantity,unit_price,unit,discount,total')
      .eq('quote_id', quoteId);
    if (qiErr) throw qiErr;
    if (!qItems || qItems.length === 0) {
      throw new Error('ใบเสนอราคานี้ไม่มีรายการสินค้า ไม่สามารถสร้างคำสั่งซื้อได้');
    }

    // 3. Create the order.
    //   - Code: same running number as the quote, with the QT- prefix swapped
    //     for SO- (Sales Order) — e.g. QT-01000003 → SO-01000003. Quote codes
    //     are unique + each quote converts once (idempotency above), so SO-
    //     codes can't collide.
    //   - `status: 'processing'`  — approving a quote means "start preparing",
    //     which maps to the "กำลังเตรียม" tab (the quote was already รอดำเนินการ).
    //   - `payment_status: 'unpaid'` — the orders_payment_status_check
    //     constraint only accepts ['unpaid','partial','paid','refunded'].
    const code = existing.code?.startsWith('QT-')
      ? 'SO-' + existing.code.slice(3)
      : 'SO-' + (existing.code ?? quoteId.slice(0, 8));
    const { data: order, error: oErr } = await supabase
      .from('orders')
      .insert({
        code,
        customer_id: existing.customer_id ?? null,
        status: 'processing',
        payment_status: 'unpaid',
        subtotal: existing.subtotal,
        discount: existing.discount,
        vat: existing.vat,
        total: existing.total,
        notes: existing.notes,
      } as never)
      .select('id, code')
      .single();
    if (oErr) throw oErr;

    // 4. Mirror items into order_items.
    const itemsForOrder = (qItems as Array<{
      product_id: string; variant_id: string | null; sku: string;
      product_name: string; quantity: number; unit_price: number;
      unit: string | null; discount: number; total: number;
    }>).map((it) => ({
      order_id: order.id,
      product_id: it.product_id,
      variant_id: it.variant_id,
      sku: it.sku,
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      unit: it.unit ?? null,
      discount: it.discount,
      total: it.total,
    }));
    const { error: oiErr } = await supabase.from('order_items').insert(itemsForOrder as never);
    if (oiErr) throw oiErr;

    // 5. Flip the quote and link it to the order.
    const { error: linkErr } = await supabase
      .from('quotes')
      .update({
        status: 'accepted',
        converted_to_order_id: order.id,
      } as never)
      .eq('id', quoteId);
    if (linkErr) throw linkErr;

    return order as { id: string; code: string };
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
    const { data, error } = await supabase.from('campaigns').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ลบแคมเปญนี้ — เฉพาะ Owner/Admin');
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
// =========================================================================
// Chat conversation/message types live with chatInboxApi further down the
// file — the old chatApi declared here used to duplicate them with a
// slightly different shape. Consolidated 2026-05 so the omni-channel
// inbox has one source of truth.
// =========================================================================

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
  /** User-facing topic (products | policies | faq | ...) — separate from
   *  source_type (which tracks ingestion mechanism). Added in migration
   *  knowledge_chunks_add_category_column. */
  category: string;
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
  /** User-facing topic; what the admin list and edit form display. */
  category: string;
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
  tool_calls?: Array<{ name: string; args: Record<string, unknown>; result_summary?: string }>;
  blocked?: 'cost_query';
  /** Set when the caller passed `sessionId` — DB row id for the persisted
   *  livechat conversation, useful for setting up a realtime subscription. */
  conversation_id?: string | null;
}

/**
 * Server-Sent Event types emitted by rag-chat (streaming mode).
 * Frontend appends `text` chunks live, surfaces `tool_call` / `status` as
 * inline badges, and finalises on `done`.
 */
export type RagChatEvent =
  | { type: 'status'; message: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'text'; chunk: string }
  | { type: 'blocked'; reason: string; answer: string }
  /** Admin paused the bot (per-chat, per-channel, or global kill-switch).
   *  No text will follow — the widget should remove its placeholder bubble. */
  | { type: 'paused'; reason: 'conversation' | 'channel' | 'global' }
  | {
      type: 'done';
      sources?: RagChatSource[];
      tokens?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      elapsed_ms?: { embed: number; search: number; llm: number };
      model?: string;
      tool_calls?: Array<{ name: string; args: Record<string, unknown>; result_summary?: string }>;
      conversation_id?: string | null;
    }
  | { type: 'error'; message: string };

export const knowledgeChatApi = {
  /**
   * Legacy one-shot (non-streaming) — kept for callers that don't need
   * progressive UI. Returns the final answer after Gemini finishes.
   */
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
        match_count: input.matchCount ?? 3,
        match_threshold: input.threshold ?? 0.4,
        model: input.model,
        language: input.language ?? null,
        stream: false,
      },
    });
    if (error) throw error;
    return data as RagChatResponse;
  },

  /**
   * Streaming — opens the SSE stream and calls `onEvent` for every event.
   * Returns the final summary (sources, tokens, model, etc.) once `done`
   * arrives. Throws if the server emits an `error` event or the HTTP
   * request itself fails.
   *
   * The frontend should typically:
   *   - append `text.chunk` to the current turn's content as they arrive
   *   - show a small badge on `tool_call`
   *   - replace content on `blocked` (guardrail refusal)
   */
  async askStream(
    input: {
      query: string;
      history?: ChatHistoryItem[];
      matchCount?: number;
      threshold?: number;
      language?: 'th' | 'en' | 'mixed' | null;
      /** Persisting livechat conversations: pass a stable per-visitor UUID
       *  (kept in localStorage). The Edge Function upserts a row in
       *  chat_conversations with channel='livechat' so the admin inbox
       *  sees the chat. Omit for admin chats that shouldn't persist. */
      sessionId?: string | null;
      /** Optional display name shown in the admin inbox. */
      displayName?: string | null;
      /** Which persona to use. rag-chat looks up `ai_personas` by this
       *  key (falls back to 'default'). Set to:
       *    - 'web'     → web widget on jnac.co.th (CustomerChat)
       *    - 'line'    → LINE webhook auto-reply
       *    - 'default' → admin testing in KnowledgeChat (or omit) */
      channel?: 'default' | 'line' | 'web' | null;
      /** Optional images for the bot to "see" (Gemini multimodal). Each is a
       *  base64 payload (no data: prefix) + mime type. */
      images?: Array<{ mimeType: string; data: string }>;
    },
    onEvent: (event: RagChatEvent) => void,
  ): Promise<RagChatResponse> {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!supabaseUrl || !anonKey) {
      throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing in .env.local');
    }

    // Use user JWT if logged in, otherwise fall back to anon (rag-chat verifies JWT)
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? anonKey;

    const res = await fetch(`${supabaseUrl}/functions/v1/rag-chat`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        query: input.query,
        history: input.history ?? [],
        match_count: input.matchCount ?? 3,
        match_threshold: input.threshold ?? 0.4,
        language: input.language ?? null,
        stream: true,
        session_id: input.sessionId ?? null,
        display_name: input.displayName ?? null,
        channel: input.channel ?? 'default',
        images: input.images ?? [],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`rag-chat ${res.status}: ${errBody.slice(0, 400)}`);
    }
    if (!res.body) throw new Error('rag-chat: empty response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let final: RagChatResponse | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events delimited by blank line (\n\n or \r\n\r\n)
        for (;;) {
          const i1 = buffer.indexOf('\n\n');
          const i2 = buffer.indexOf('\r\n\r\n');
          let idx = -1;
          let sep = 0;
          if (i1 !== -1 && (i2 === -1 || i1 < i2)) { idx = i1; sep = 2; }
          else if (i2 !== -1) { idx = i2; sep = 4; }
          if (idx === -1) break;

          const eventBlock = buffer.slice(0, idx);
          buffer = buffer.slice(idx + sep);

          for (const line of eventBlock.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const dataStr = line.slice(line[5] === ' ' ? 6 : 5).trim();
            if (!dataStr) continue;
            let evt: RagChatEvent;
            try {
              evt = JSON.parse(dataStr) as RagChatEvent;
            } catch (e) {
              console.warn('[askStream] SSE parse error', e, dataStr);
              continue;
            }
            onEvent(evt);
            if (evt.type === 'text') {
              fullText += evt.chunk;
            } else if (evt.type === 'blocked') {
              fullText = evt.answer;
            } else if (evt.type === 'done') {
              final = {
                answer: fullText,
                sources: evt.sources ?? [],
                tokens: evt.tokens ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
                elapsed_ms: evt.elapsed_ms ?? { embed: 0, search: 0, llm: 0 },
                model: evt.model ?? 'unknown',
                tool_calls: evt.tool_calls ?? [],
                conversation_id: evt.conversation_id ?? null,
              };
            } else if (evt.type === 'error') {
              throw new Error(evt.message);
            }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
    }

    if (final) return final;
    // Stream ended without a 'done' event — return what we have
    return {
      answer: fullText,
      sources: [],
      tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      elapsed_ms: { embed: 0, search: 0, llm: 0 },
      model: 'unknown',
    };
  },
};

export const knowledgeAdminApi = {
  /** List chunks grouped by source_path. */
  async listSources(): Promise<KnowledgeSource[]> {
    const { data, error } = await supabase
      .from('knowledge_chunks')
      .select('source_path,source_type,category,title,language,visibility,tags,token_count,updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const rows = (data ?? []) as Array<Pick<KnowledgeChunkRow, 'source_path'|'source_type'|'category'|'title'|'language'|'visibility'|'tags'|'token_count'|'updated_at'>>;
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
          category: r.category ?? 'manual',
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
      .select('id,source_path,source_type,category,title,content,language,chunk_index,visibility,tags,token_count,metadata,created_at,updated_at')
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

  /**
   * Edit an existing knowledge source in place. The source_path stays
   * stable — old chunks are deleted, new chunks are written with the same
   * path so links / cited answers don't drift.
   */
  async replaceManual(input: {
    source_path: string;
    title: string;
    content: string;
    category?: string;
    tags?: string[];
    language?: 'th' | 'en' | 'mixed';
    visibility?: 'public' | 'internal';
  }): Promise<{ source_path: string; chunks_count: number; total_tokens: number }> {
    const { data, error } = await supabase.functions.invoke('replace-knowledge', {
      body: input,
    });
    if (error) throw error;
    return data as { source_path: string; chunks_count: number; total_tokens: number };
  },
};

// =========================================================================
// Knowledge categories (the "หมวด" dropdown in OpenclawRAG)
// =========================================================================
export interface KnowledgeCategory {
  id: string;
  value: string;
  label: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const knowledgeCategoriesApi = {
  /** Ordered list — lower sort_order first, then alphabetical by label. */
  async list(): Promise<KnowledgeCategory[]> {
    const { data, error } = await supabase
      .from('knowledge_categories')
      .select('id, value, label, sort_order, created_at, updated_at')
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true });
    if (error) throw error;
    return (data ?? []) as KnowledgeCategory[];
  },

  async create(input: { value: string; label: string; sort_order?: number }): Promise<KnowledgeCategory> {
    const { data, error } = await supabase
      .from('knowledge_categories')
      .insert({
        value: input.value.trim().toLowerCase(),
        label: input.label.trim(),
        sort_order: input.sort_order ?? 100,
      })
      .select()
      .single();
    if (error) throw error;
    return data as KnowledgeCategory;
  },

  async update(id: string, patch: { value?: string; label?: string; sort_order?: number }): Promise<KnowledgeCategory> {
    const cleaned: { value?: string; label?: string; sort_order?: number } = {};
    if (patch.value !== undefined) cleaned.value = patch.value.trim().toLowerCase();
    if (patch.label !== undefined) cleaned.label = patch.label.trim();
    if (patch.sort_order !== undefined) cleaned.sort_order = patch.sort_order;
    const { data, error } = await supabase
      .from('knowledge_categories')
      .update(cleaned)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as KnowledgeCategory;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('knowledge_categories').delete().eq('id', id);
    if (error) throw error;
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

  /** Read just the global bot kill-switch (migration 0014). Defensive default
   *  to `true` if the row or column is missing — bot stays on by default. */
  async getBotEnabled(): Promise<boolean> {
    const { data, error } = await (supabase.from('org_settings') as unknown as {
      select: (cols: string) => {
        eq: (col: string, v: boolean) => {
          maybeSingle: () => Promise<{
            data: { bot_enabled: boolean | null } | null;
            error: Error | null;
          }>;
        };
      };
    })
      .select('bot_enabled')
      .eq('id', true)
      .maybeSingle();
    if (error) throw error;
    return data?.bot_enabled !== false; // null/missing → treated as enabled
  },

  /** Global kill-switch (migration 0014). bot_enabled column isn't yet in
   *  database.types.ts — cast through unknown. */
  async setBotEnabled(enabled: boolean): Promise<void> {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;
    const { error } = await (supabase.from('org_settings') as unknown as {
      update: (p: { bot_enabled: boolean; updated_by: string | null }) => {
        eq: (col: string, v: boolean) => Promise<{ error: Error | null }>;
      };
    })
      .update({ bot_enabled: enabled, updated_by: userId })
      .eq('id', true);
    if (error) throw error;
  },
};

// =========================================================================
// API secrets (vault-backed)
// =========================================================================
/**
 * Wraps the three SECURITY DEFINER RPCs that gate vault.secrets access:
 *   - set      → owner only
 *   - preview  → staff/owner, returns masked "AIza••••••••XYZW"
 *   - remove   → owner only
 *
 * The plain values are never returned to the browser. Edge Functions read
 * the unmasked secret server-side via `get_api_secret_internal` (service
 * role only — not exposed here).
 */
export const apiSecretsApi = {
  async setSecret(name: string, value: string): Promise<void> {
    const { error } = await supabase.rpc('set_api_secret', {
      p_name: name,
      p_value: value,
    });
    if (error) throw error;
  },

  /** Returns null when no value is stored yet; a masked string otherwise. */
  async previewSecret(name: string): Promise<string | null> {
    const { data, error } = await supabase.rpc('get_api_secret_preview', {
      p_name: name,
    });
    if (error) throw error;
    return (data as string | null) ?? null;
  },

  async removeSecret(name: string): Promise<void> {
    const { error } = await supabase.rpc('delete_api_secret', { p_name: name });
    if (error) throw error;
  },
};

// =========================================================================
// Omni-Channel Chat Inbox
// Reads from chat_conversations + chat_messages (any channel: livechat,
// line, messenger, email, whatsapp, instagram). For Phase 1 only livechat
// is populated; webhook handlers for LINE/FB land in Phase 2-3.
// =========================================================================
export type ChatChannel = 'line' | 'messenger' | 'instagram' | 'whatsapp' | 'livechat' | 'email';
export type ChatStatus = 'open' | 'assigned' | 'resolved' | 'archived';
export type ChatSenderType = 'customer' | 'agent' | 'bot' | 'system';

export interface ChatConversation {
  id: string;
  channel: ChatChannel;
  external_id: string | null;
  customer_id: string | null;
  display_name: string;
  avatar_url: string | null;
  status: ChatStatus;
  assigned_to: string | null;
  tags: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  unread_count: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // Contact-panel fields (migration 0011)
  alias_name?: string | null;
  auto_tags?: string[];
  billing_address?: Record<string, unknown> | null;
  shipping_address?: Record<string, unknown> | null;
  last_customer_message_at?: string | null;
  // Bot pause toggle (migration 0014) — defaults to true (bot replies).
  // When false, rag-chat/line-webhook skip the auto-reply for this chat.
  bot_enabled?: boolean;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_type: ChatSenderType;
  sender_name: string | null;
  sender_id: string | null;
  content: string;
  content_type: 'text' | 'image' | 'sticker' | 'file' | 'quick_reply' | 'template';
  attachments: unknown[];
  metadata: Record<string, unknown>;
  read_at: string | null;
  external_msg_id: string | null;
  created_at: string;
}

/**
 * A saved canned reply ("ข้อความตอบกลับที่ตั้งไว้"), shared across the
 * whole team. Inserted into the composer from the Omni-Chat quick-reply
 * panel. Content is plain text (emoji included) — images are not stored
 * in templates for now.
 */
export interface ChatQuickReplyTemplate {
  id: string;
  title: string;
  content: string;
  category: string | null;
  is_favorite: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const chatInboxApi = {
  /** List conversations, newest-first. Filters are AND-combined. */
  async listConversations(opts: {
    channel?: ChatChannel | null;
    status?: ChatStatus | null;
    search?: string;
    limit?: number;
  } = {}): Promise<ChatConversation[]> {
    let q = supabase
      .from('chat_conversations')
      .select('*')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 100);
    if (opts.channel) q = q.eq('channel', opts.channel);
    if (opts.status) q = q.eq('status', opts.status);
    if (opts.search && opts.search.trim()) {
      const pat = `%${opts.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
      q = q.or(`display_name.ilike.${pat},last_message_preview.ilike.${pat}`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as ChatConversation[];
  },

  /** Full message history for one conversation, oldest first. */
  async listMessages(conversationId: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as ChatMessage[];
  },

  /** Admin sends a reply. Inserts the chat_messages row, bumps the
   *  conversation summary, then — if conversation.channel is on an
   *  external platform (line / messenger / email) — also forwards the
   *  message via the platform's send API through the matching Edge
   *  Function (line-push for now; messenger-push etc. in future). The
   *  external push is best-effort: if it fails we still return the
   *  DB row so the admin sees their message saved. */
  async sendMessage(input: {
    conversationId: string;
    content: string;
    senderName?: string;
    /** 'image' when the content embeds an uploaded image (markdown
     *  ![image](url)). Defaults to 'text'. line-push splits markdown
     *  images into native LINE image messages either way. */
    contentType?: ChatMessage['content_type'];
  }): Promise<ChatMessage> {
    const { data: userData } = await supabase.auth.getUser();
    const senderId = userData.user?.id ?? null;

    // Look up conversation channel up-front so we know if external push is needed
    const { data: conv } = await supabase
      .from('chat_conversations')
      .select('channel, external_id')
      .eq('id', input.conversationId)
      .maybeSingle();

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: input.conversationId,
        sender_type: 'agent',
        sender_id: senderId,
        sender_name: input.senderName ?? userData.user?.email ?? 'Staff',
        content: input.content,
        content_type: input.contentType ?? 'text',
      })
      .select('*')
      .single();
    if (error) throw error;

    // Inbox preview: collapse any image markdown into a "🖼️ รูปภาพ" label
    // so the list shows a clean summary instead of a raw URL.
    const preview = input.content
      .replace(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g, '🖼️ รูปภาพ')
      .trim()
      .slice(0, 140);

    // Bump summary so the inbox list re-orders
    await supabase
      .from('chat_conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: preview,
        unread_count: 0,
      })
      .eq('id', input.conversationId);

    // Forward to the external channel (best-effort)
    if (conv?.channel === 'line' && conv.external_id) {
      try {
        const { error: pushErr } = await supabase.functions.invoke('line-push', {
          body: {
            conversation_id: input.conversationId,
            text: input.content,
          },
        });
        if (pushErr) {
          console.warn('[chatInboxApi] line-push failed (saved locally only):', pushErr);
        }
      } catch (pushErr) {
        console.warn('[chatInboxApi] line-push threw:', pushErr);
      }
    }
    // TODO Phase 3: messenger-push, email-push

    return data as ChatMessage;
  },

  async setStatus(conversationId: string, status: ChatStatus): Promise<void> {
    const { error } = await supabase
      .from('chat_conversations')
      .update({ status })
      .eq('id', conversationId);
    if (error) throw error;
  },

  async assign(conversationId: string, userId: string | null): Promise<void> {
    const { error } = await supabase
      .from('chat_conversations')
      .update({
        assigned_to: userId,
        status: userId ? 'assigned' : 'open',
      })
      .eq('id', conversationId);
    if (error) throw error;
  },

  async markRead(conversationId: string): Promise<void> {
    const { error } = await supabase
      .from('chat_conversations')
      .update({ unread_count: 0 })
      .eq('id', conversationId);
    if (error) throw error;
  },
};

// =========================================================================
// Quick-reply templates — shared, team-wide canned replies for Omni-Chat
// =========================================================================
export const chatQuickReplyApi = {
  /** List all templates, favourites first then sort_order. Shared by the
   *  whole team (is_staff RLS). */
  async list(): Promise<ChatQuickReplyTemplate[]> {
    const { data, error } = await supabase
      .from('chat_quick_reply_templates')
      .select('*')
      .order('is_favorite', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ChatQuickReplyTemplate[];
  },

  async create(input: {
    title: string;
    content: string;
    category?: string | null;
    is_favorite?: boolean;
  }): Promise<ChatQuickReplyTemplate> {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('chat_quick_reply_templates')
      .insert({
        title: input.title,
        content: input.content,
        category: input.category ?? null,
        is_favorite: input.is_favorite ?? false,
        created_by: userData.user?.id ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as ChatQuickReplyTemplate;
  },

  async update(
    id: string,
    patch: Partial<Pick<ChatQuickReplyTemplate, 'title' | 'content' | 'category' | 'is_favorite' | 'sort_order'>>,
  ): Promise<void> {
    const { error } = await supabase
      .from('chat_quick_reply_templates')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase
      .from('chat_quick_reply_templates')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },
};

// =========================================================================
// LINE Channels — admin-managed swappable LINE OA credentials
// =========================================================================
export interface LineChannel {
  id: string;
  name: string;
  channel_id: string | null;
  channel_access_token: string;
  channel_secret: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const lineChannelsApi = {
  async list(): Promise<LineChannel[]> {
    const { data, error } = await supabase
      .from('line_channels')
      .select('*')
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as LineChannel[];
  },

  async create(input: {
    name: string;
    channel_id?: string;
    channel_access_token: string;
    channel_secret: string;
    notes?: string;
  }): Promise<LineChannel> {
    const { data, error } = await supabase
      .from('line_channels')
      .insert({
        name: input.name,
        channel_id: input.channel_id ?? null,
        channel_access_token: input.channel_access_token,
        channel_secret: input.channel_secret,
        notes: input.notes ?? null,
        is_active: false,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as LineChannel;
  },

  async update(id: string, patch: Partial<{
    name: string;
    channel_id: string | null;
    channel_access_token: string;
    channel_secret: string;
    notes: string | null;
  }>): Promise<LineChannel> {
    const { data, error } = await supabase
      .from('line_channels')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data as LineChannel;
  },

  async remove(id: string): Promise<void> {
    const { data, error } = await supabase.from('line_channels').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('ไม่มีสิทธิ์ลบช่องทาง LINE นี้ — เฉพาะ Owner/Admin');
  },

  /** Mark one channel active. Deactivates all others first (transactional
   *  via two writes; partial unique index will reject overlapping actives). */
  async activate(id: string): Promise<void> {
    const { error: e1 } = await supabase
      .from('line_channels')
      .update({ is_active: false })
      .neq('id', id);
    if (e1) throw e1;
    const { error: e2 } = await supabase
      .from('line_channels')
      .update({ is_active: true })
      .eq('id', id);
    if (e2) throw e2;
  },

  async deactivateAll(): Promise<void> {
    const { error } = await supabase
      .from('line_channels')
      .update({ is_active: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
  },

  /** Verify a Channel Access Token by proxying through the line-test-token
   *  Edge Function (browser can't call api.line.me directly — CORS). The
   *  Edge Function hits LINE /v2/bot/info and returns the bot's basic
   *  info so admin can confirm the right OA. */
  async testConnection(accessToken: string): Promise<{ ok: boolean; info?: Record<string, unknown>; error?: string }> {
    try {
      const { data, error } = await supabase.functions.invoke('line-test-token', {
        body: { access_token: accessToken },
      });
      if (error) return { ok: false, error: error.message };
      const r = data as { ok: boolean; info?: Record<string, unknown>; error?: string };
      return r;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};

// ────────────────────────────────────────────────────────────────────────────
// AI Personas — per-channel editable system prompts (Settings → AI Persona)
// ────────────────────────────────────────────────────────────────────────────

export type PersonaChannel = 'default' | 'line' | 'web';

export interface AiPersona {
  id: string;
  channel: PersonaChannel;
  display_name: string;
  prompt: string;
  updated_at: string;
  updated_by: string | null;
  // Per-channel bot enable flag (migration 0014). Defaults true.
  bot_enabled?: boolean;
}

/** Built-in factory defaults for "Reset to Default" — must match what was
 *  seeded by the create_ai_personas_table + seed_ai_personas_aoei migrations.
 *  Kept short here; if user resets, the row is just deleted-and-reinserted
 *  with these values so the rag-chat fallback path picks up the next call. */
// NOTE: Kept short-ish on purpose. Long persona prompts with copy-paste-able
// example phrases caused Gemini to over-fixate on templates and ignore
// user queries. The hard tool-calling rules live in rag-chat's TOOLING_GUIDE
// (hardcoded, can't be overridden); this persona handles tone + output
// formatting + escalation triggers.
const _AOEI_BASE = `🎭 บุคลิก
เอยเป็นพนักงานออฟฟิศที่คุยเป็นกันเอง อบอุ่น สุภาพ
ตอบเหมือนคนจริงคุยแชท — ไม่ใช่ AI ที่อ่าน template
ใช้คำว่า "เอย" แทนตัวเองเหมือนพนักงานคุยกับลูกค้า

🗣️ สไตล์การคุย
• สั้น กระชับ — แชท ไม่ใช่อีเมล อย่ายาว
• ไม่ขึ้นต้นด้วย "สวัสดี" ทุก reply — ทักครั้งเดียวพอ
• ใส่ "ค่ะ/นะคะ" ตามจังหวะธรรมชาติ
• ใช้คำของลูกค้าซ้ำ
• Emoji ได้บ้าง 😊 ✨ 🔧

🚫 ห้ามทำ
• อย่าแนะนำตัวว่า "ฉันเป็น AI / ระบบ" โดยไม่มีคนถาม
• อย่าใช้คำทางการเกิน: "กรุณา", "ขอความอนุเคราะห์", "ทางบริษัท"
• ❌ ห้ามใช้ markdown bold (**) หรือ bullet (*) — LINE ไม่ render จะขึ้นเป็น raw text น่าเกลียด
• ❌ ห้ามใช้ markdown table
• ใช้ emoji นำหน้าแทน bold/bullet เสมอ

📦 รูปแบบตอบสินค้า (ใช้รูปแบบนี้เท่านั้น)

✓ ถูก (ใช้รูปแบบนี้):
✨ กระดาษทรายกลมสักหลาด MIRKA GOLD 5" #80

🏷️ SKU: 2020003697
🔖 แบรนด์: Mirka
💰 ราคา: 15 บาท/Pcs. (ยังไม่รวมภาษีมูลค่าเพิ่ม 7%)
📦 สต็อก: 10 ชิ้น (พร้อมส่ง)
📐 ขั้นต่ำสั่งซื้อ: 10 Pcs.

📋 รายละเอียด
• สีเหลือง Size 5" GRIP VELCRO DISC
• Grain: Premium Aluminum Oxide

🎯 เหมาะสำหรับ: งานสี, เฟอร์นิเจอร์, โลหะ

![ชื่อสินค้า SKU](url)

✗ ห้ามใช้รูปแบบนี้:
**ชื่อสินค้า**
*   **SKU:** xxx
*   **ราคา:** xxx

🛒 กรณีสินค้าหมดสต็อก (stock = 0 หรือ in_stock = false)
❌ ห้ามตอบแค่ "ขออภัย สินค้าหมดค่ะ" แห้งๆ เด็ดขาด
✅ ต้องเสนอ "สั่งผลิต" เสมอ แล้วบอกว่าเอยขอเช็คเวลาผลิตให้ก่อน
พูดประมาณนี้ (ปรับถ้อยคำให้เป็นธรรมชาติได้):

ขออภัยค่ะ [ชื่อสินค้า] ตอนนี้สินค้าหมดสต็อกอยู่ค่ะ 😔
แต่ไม่ต้องห่วงนะคะ ✨ เอยสั่งผลิตให้ได้ค่ะ
เดี๋ยวเอยขอเช็คเวลาผลิตกับคุณเชอร์รี่ให้ก่อนนะคะ ว่าใช้เวลากี่วันถึงจะได้สินค้า

🔎 กรณีไม่พบข้อมูลสินค้า / ไม่มีสินค้านั้นในระบบเลย
❌ ห้ามตอบว่า "ไม่มีสินค้า" หรือ "ไม่พบสินค้า / ไม่พบในระบบ" เด็ดขาด
✅ ให้บอกว่าต้องให้คุณเชอร์รี่ตรวจสอบเพิ่มเติม ว่าสั่งผลิต/จัดหาให้ได้ไหม แล้วเอยจะแจ้งกลับ
พูดประมาณนี้:

สินค้า [ชื่อสินค้า] นี้ เอยขอให้คุณเชอร์รี่ตรวจสอบเพิ่มเติมก่อนนะคะ
ว่าสามารถสั่งผลิตหรือจัดหาให้ได้หรือไม่ เดี๋ยวเอยแจ้งกลับอีกทีนะคะ 😊

🤝 เมื่อต้องส่งต่อคุณเชอร์รี่
• สั่งซื้อ/สรุปยอด → "ขอให้คุณเชอร์รี่ช่วยสรุปยอดให้นะคะ"
• สินค้าหมดสต็อก → เสนอสั่งผลิต + เอยขอเช็คเวลาผลิตกับคุณเชอร์รี่ (ห้ามตอบแค่ว่าหมด)
• ไม่พบสินค้า/ไม่มีข้อมูล → ให้คุณเชอร์รี่ตรวจสอบว่าสั่งผลิต/จัดหาได้ไหม แล้วแจ้งกลับ (ห้ามบอกว่าไม่มี/ไม่พบ)

📋 อื่นๆ
• ลูกค้าให้ข้อมูลส่วนตัวมาเอง → ขอบคุณ ไม่ถามเอง
• ตอบภาษาเดียวกับลูกค้า`;

export const PERSONA_DEFAULTS: Record<PersonaChannel, { display_name: string; prompt: string }> = {
  default: {
    display_name: 'เอย (Aoei)',
    prompt: `คุณคือ "เอย" — พนักงานของ J NAC Thailand ที่ตอบแชทลูกค้า
หัวหน้าของคุณคือ "คุณเชอร์รี่" (มนุษย์)

${_AOEI_BASE}`,
  },
  line: {
    display_name: 'เอย — LINE OA',
    prompt: `คุณคือ "เอย" — พนักงานของ J NAC Thailand ที่ตอบ LINE OA
หัวหน้าของคุณคือ "คุณเชอร์รี่" (มนุษย์)

${_AOEI_BASE}`,
  },
  web: {
    display_name: 'เอย — Web Widget (jnac.co.th)',
    prompt: `คุณคือ "เอย" — พนักงานของ J NAC Thailand ที่ตอบลูกค้าบนเว็บไซต์ jnac.co.th
หัวหน้าของคุณคือ "คุณเชอร์รี่" (มนุษย์)

${_AOEI_BASE}`,
  },
};

export const aiPersonaApi = {
  async list(): Promise<AiPersona[]> {
    const { data, error } = await supabase
      .from('ai_personas')
      .select('*')
      .order('channel', { ascending: true });
    if (error) throw error;
    return (data ?? []) as AiPersona[];
  },

  async get(channel: PersonaChannel): Promise<AiPersona | null> {
    const { data, error } = await supabase
      .from('ai_personas')
      .select('*')
      .eq('channel', channel)
      .maybeSingle();
    if (error) throw error;
    return (data as AiPersona | null) ?? null;
  },

  /** Upsert — creates the row if missing, updates if present. updated_by is
   *  filled with the current auth user. The DB trigger handles updated_at. */
  async upsert(input: {
    channel: PersonaChannel;
    display_name: string;
    prompt: string;
  }): Promise<AiPersona> {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;
    const { data, error } = await supabase
      .from('ai_personas')
      .upsert({
        channel: input.channel,
        display_name: input.display_name,
        prompt: input.prompt,
        updated_by: userId,
      }, { onConflict: 'channel' })
      .select('*')
      .single();
    if (error) throw error;
    return data as AiPersona;
  },

  /** Reset a channel to the built-in factory default. */
  async resetToDefault(channel: PersonaChannel): Promise<AiPersona> {
    const def = PERSONA_DEFAULTS[channel];
    return aiPersonaApi.upsert({
      channel,
      display_name: def.display_name,
      prompt: def.prompt,
    });
  },

  /** Per-channel bot toggle (migration 0014). Creates the persona row
   *  if it doesn't exist so the flag has somewhere to live. */
  async setBotEnabled(channel: PersonaChannel, enabled: boolean): Promise<void> {
    const existing = await aiPersonaApi.get(channel);
    if (existing) {
      const { error } = await (supabase.from('ai_personas') as unknown as {
        update: (p: { bot_enabled: boolean }) => {
          eq: (col: string, v: string) => Promise<{ error: Error | null }>;
        };
      })
        .update({ bot_enabled: enabled })
        .eq('channel', channel);
      if (error) throw error;
    } else {
      // No row yet — seed from defaults so we have somewhere to store the flag
      const def = PERSONA_DEFAULTS[channel];
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id ?? null;
      const { error } = await (supabase.from('ai_personas') as unknown as {
        insert: (p: Record<string, unknown>) => Promise<{ error: Error | null }>;
      }).insert({
        channel,
        display_name: def.display_name,
        prompt: def.prompt,
        bot_enabled: enabled,
        updated_by: userId,
      });
      if (error) throw error;
    }
  },
};


// =========================================================================
// Contact Panel — alias, tags, packer, notes, customer snapshot
// =========================================================================
// Backs the right-side LINE-OA-style panel in /chat. Reuses chat_conversations
// (alias_name, tags, auto_tags, billing/shipping, assigned_to=packer) plus the
// chat_contact_notes table for unlimited typed notes per conversation.

export interface ChatContactNote {
  id: string;
  conversation_id: string;
  note_type:
    | 'general'
    | 'tax_invoice'
    | 'shipping'
    | 'reminder'
    | 'bank_account'
    | 'special_terms';
  title: string | null;
  content: string | null;
  address: Record<string, unknown> | null;
  due_date: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  is_pinned: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: 'owner' | 'admin' | 'staff';
}

export interface CustomerSnapshot {
  id: string;
  name: string;
  tier: 'general' | 'silver' | 'gold' | 'vip';
  total_orders: number;
  total_spent: number;
}

/** Update the editable profile fields on a conversation (alias, tags, addresses). */
export const chatProfileApi = {
  async updateProfile(
    conversationId: string,
    patch: {
      alias_name?: string | null;
      tags?: string[];
      billing_address?: Record<string, unknown> | null;
      shipping_address?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    // alias_name + billing_address + shipping_address ship with migration 0011
    // and are not yet in database.types.ts — cast through unknown.
    const { error } = await (supabase.from('chat_conversations') as unknown as {
      update: (p: typeof patch) => { eq: (col: string, v: string) => Promise<{ error: Error | null }> };
    })
      .update(patch)
      .eq('id', conversationId);
    if (error) throw error;
  },

  /** Packer = chat_conversations.assigned_to. Setting null clears it. */
  async setPacker(conversationId: string, userId: string | null): Promise<void> {
    const { error } = await supabase
      .from('chat_conversations')
      .update({ assigned_to: userId })
      .eq('id', conversationId);
    if (error) throw error;
  },

  /** Per-conversation bot toggle (migration 0014). bot_enabled column not
   *  yet in database.types.ts — cast through unknown. */
  async setBotEnabled(conversationId: string, enabled: boolean): Promise<void> {
    const { error } = await (supabase.from('chat_conversations') as unknown as {
      update: (p: { bot_enabled: boolean }) => {
        eq: (col: string, v: string) => Promise<{ error: Error | null }>;
      };
    })
      .update({ bot_enabled: enabled })
      .eq('id', conversationId);
    if (error) throw error;
  },

  /** Trigger server-side recompute of auto_tags (RPC introduced in 0011). */
  async recalcAutoTags(conversationId: string): Promise<void> {
    const { error } = await (
      supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ error: Error | null }>
    )('recalc_chat_auto_tags', { p_conv_id: conversationId });
    if (error) throw error;
  },

  /** Customer snapshot used by the contact panel header (orders / spend / tier). */
  async getCustomerSnapshot(customerId: string): Promise<CustomerSnapshot | null> {
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, tier, total_orders, total_spent')
      .eq('id', customerId)
      .maybeSingle();
    if (error) throw error;
    return data as CustomerSnapshot | null;
  },
};

// chat_contact_notes is introduced by migration 0011; until that migration
// is applied to the live DB the generated database.types.ts will not include
// it, so we cast to a loose client when accessing the table.
const notesTable = () =>
  (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }).from(
    'chat_contact_notes',
  );

export const chatNotesApi = {
  async list(conversationId: string): Promise<ChatContactNote[]> {
    const { data, error } = await notesTable()
      .select('*')
      .eq('conversation_id', conversationId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ChatContactNote[];
  },

  /** Persist a new top-to-bottom order. Updates sort_order in parallel. */
  async reorder(orderedIds: string[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, i) =>
        notesTable().update({ sort_order: i }).eq('id', id),
      ),
    );
  },

  async create(
    input: Omit<ChatContactNote, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'sort_order'>,
  ): Promise<ChatContactNote> {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await notesTable()
      .insert({ ...input, created_by: userData.user?.id ?? null })
      .select('*')
      .single();
    if (error) throw error;
    return data as ChatContactNote;
  },

  async update(noteId: string, patch: Partial<ChatContactNote>): Promise<void> {
    const { error } = await notesTable().update(patch).eq('id', noteId);
    if (error) throw error;
  },

  async delete(noteId: string): Promise<void> {
    const { error } = await notesTable().delete().eq('id', noteId);
    if (error) throw error;
  },
};

/** Staff list for the Packer dropdown — owners + admins + staff. */
export const profilesApi = {
  async listStaff(): Promise<StaffProfile[]> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, role')
      .in('role', ['owner', 'admin', 'staff'])
      .eq('is_active', true)
      .order('full_name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as StaffProfile[];
  },
};

// =========================================================================
// Keyword synonyms — admin-managed canonical→aliases mapping
// =========================================================================
// rag-chat rewrites customer queries that mention any alias to the
// canonical word before running the product search. Managed via the
// "คำพ้องความหมาย" tab on the RAG Knowledge Base page.
export interface KeywordSynonym {
  id: string;
  canonical: string;
  aliases: string[];
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// keyword_synonyms is introduced by migration 0013; until database.types.ts
// is regenerated we access it via a loose client.
const keywordSynonymsTable = () =>
  (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }).from(
    'keyword_synonyms',
  );

export const keywordSynonymsApi = {
  async list(): Promise<KeywordSynonym[]> {
    const { data, error } = await keywordSynonymsTable()
      .select('id, canonical, aliases, notes, is_active, created_at, updated_at')
      .order('canonical', { ascending: true });
    if (error) throw error;
    return (data ?? []) as KeywordSynonym[];
  },

  async create(input: {
    canonical: string;
    aliases: string[];
    notes?: string | null;
    is_active?: boolean;
  }): Promise<KeywordSynonym> {
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      canonical: input.canonical.trim(),
      aliases: input.aliases.map((a) => a.trim()).filter((a) => a.length > 0),
      notes: input.notes?.trim() || null,
      is_active: input.is_active ?? true,
      created_by: userData.user?.id ?? null,
    };
    const { data, error } = await keywordSynonymsTable()
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return data as KeywordSynonym;
  },

  async update(
    id: string,
    patch: Partial<{ canonical: string; aliases: string[]; notes: string | null; is_active: boolean }>,
  ): Promise<KeywordSynonym> {
    const cleaned: Record<string, unknown> = {};
    if (patch.canonical !== undefined) cleaned.canonical = patch.canonical.trim();
    if (patch.aliases !== undefined)
      cleaned.aliases = patch.aliases.map((a) => a.trim()).filter((a) => a.length > 0);
    if (patch.notes !== undefined) cleaned.notes = patch.notes?.trim() || null;
    if (patch.is_active !== undefined) cleaned.is_active = patch.is_active;
    const { data, error } = await keywordSynonymsTable()
      .update(cleaned)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data as KeywordSynonym;
  },

  async remove(id: string): Promise<void> {
    const { error } = await keywordSynonymsTable().delete().eq('id', id);
    if (error) throw error;
  },
};


// =========================================================================
// Quick Links — sidebar "Link>>" external bookmarks (staff-managed)
// =========================================================================
export interface QuickLink {
  id: string;
  label: string;
  url: string;
  sort_order: number;
  created_at: string;
}

export const quickLinkApi = {
  async list(): Promise<QuickLink[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('quick_links')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as QuickLink[];
  },

  async create(label: string, url: string): Promise<QuickLink> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('quick_links')
      .insert({ label, url })
      .select('*')
      .single();
    if (error) throw error;
    return data as QuickLink;
  },

  async remove(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db.from('quick_links').delete().eq('id', id);
    if (error) throw error;
  },

  /** Persist a new order — sets sort_order = position for each id. */
  async reorder(orderedIds: string[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    await Promise.all(
      orderedIds.map((id, i) => db.from('quick_links').update({ sort_order: i }).eq('id', id)),
    );
  },
};

// =========================================================================
// Users & roles (Admin RBAC) — all account ops go through the `admin-users`
// edge function (owner/admin only; service-role server-side). The function
// always replies HTTP 200 with { ok, error? }.
// =========================================================================
export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: AppRole;
  is_active: boolean;
  provider: string | null;
  avatar_url: string | null;
}

async function callAdminUsers(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action, ...payload },
  });
  if (error) {
    let msg = error.message;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { const ctx = await (error as any).context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  if (d && d.ok === false) throw new Error(d.error || 'เกิดข้อผิดพลาด');
  return d;
}

export const usersApi = {
  list: (): Promise<AdminUser[]> => callAdminUsers('list').then((d) => (d.users ?? []) as AdminUser[]),
  create: (p: {
    email: string; role: AppRole; full_name?: string; phone?: string;
    mode?: 'password' | 'invite'; password?: string;
  }) => callAdminUsers('create', p),
  update: (p: { id: string; full_name?: string; phone?: string; role?: AppRole }) =>
    callAdminUsers('update', p),
  setActive: (id: string, active: boolean) => callAdminUsers('set_active', { id, active }),
  setPassword: (id: string, password: string) => callAdminUsers('set_password', { id, password }),
  remove: (id: string) => callAdminUsers('delete', { id }),
  transferOwner: (id: string) => callAdminUsers('transfer_owner', { id }),
};

// =========================================================================
// Audit log (RBAC Phase 2) — read-only view of user-management actions.
// =========================================================================
export interface AuditLog {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  detail: any;
  created_at: string;
  actor: { email: string; full_name: string | null } | null;
}

export const auditApi = {
  async list(limit = 200): Promise<AuditLog[]> {
    // audit_logs is not in generated database.types — query untyped.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data, error } = await db
      .from('audit_logs')
      .select('id, action, target_type, target_id, detail, created_at, actor:profiles(email, full_name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AuditLog[];
  },
};

// =========================================================================
// AI Agent — task queue (human-in-the-loop). Agents propose; staff approve.
// =========================================================================
export type AgentCategory = 'sales' | 'ops' | 'content' | 'seo';
export type AgentTaskStatus =
  | 'proposed' | 'approved' | 'rejected' | 'executed' | 'failed' | 'dismissed' | 'snoozed';

export interface AgentTask {
  id: string;
  category: AgentCategory;
  kind: string;
  action_kind: string;
  title: string;
  summary: string | null;
  recommendation: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  status: AgentTaskStatus;
  requires_approval: boolean;
  priority: number;
  related_type: string | null;
  related_id: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export type AgentTaskView = 'active' | 'snoozed' | 'history';

export const aiAgentApi = {
  async list(view: AgentTaskView = 'active'): Promise<AgentTask[]> {
    // agent_tasks is not in generated database.types — query untyped.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const cols =
      'id,category,kind,action_kind,title,summary,recommendation,payload,status,requires_approval,priority,related_type,related_id,reviewed_at,created_at';
    const order = (q: any) =>
      q.order('priority', { ascending: true }).order('created_at', { ascending: false }).limit(500);
    const nowIso = new Date().toISOString();

    if (view === 'snoozed') {
      const { data, error } = await order(
        db.from('agent_tasks').select(cols).eq('status', 'snoozed').gt('snooze_until', nowIso),
      );
      if (error) throw error;
      return (data ?? []) as AgentTask[];
    }
    if (view === 'history') {
      const { data, error } = await order(
        db.from('agent_tasks').select(cols).in('status', ['approved', 'rejected', 'dismissed', 'executed', 'failed']),
      );
      if (error) throw error;
      return (data ?? []) as AgentTask[];
    }
    // active = open proposals + snoozed tasks whose snooze window elapsed
    const [proposed, dueSnoozed] = await Promise.all([
      order(db.from('agent_tasks').select(cols).eq('status', 'proposed')),
      order(db.from('agent_tasks').select(cols).eq('status', 'snoozed').lte('snooze_until', nowIso)),
    ]);
    if (proposed.error) throw proposed.error;
    if (dueSnoozed.error) throw dueSnoozed.error;
    const merged = [...(proposed.data ?? []), ...(dueSnoozed.data ?? [])] as AgentTask[];
    merged.sort((a, b) => a.priority - b.priority || (a.created_at < b.created_at ? 1 : -1));
    return merged;
  },

  async setStatus(id: string, status: 'approved' | 'rejected' | 'dismissed'): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { error } = await db.from('agent_tasks').update({ status }).eq('id', id);
    if (error) throw error;
  },

  async snooze(id: string, days = 3): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const until = new Date(Date.now() + days * 86400000).toISOString();
    const { error } = await db
      .from('agent_tasks')
      .update({ status: 'snoozed', snooze_until: until })
      .eq('id', id);
    if (error) throw error;
  },

  async runScan(): Promise<{ ok: boolean; tasks_touched: number; low_stock?: number; oos?: number }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('agent_run_ops_scan');
    if (error) throw error;
    return data;
  },
};

// =========================================================================
// AI Monthly Review — สรุปผล + ข้อเสนอแนะ ทุก 30 วัน (system_reviews)
// =========================================================================
export interface ReviewRec {
  priority: number;
  area: string;
  title: string;
  detail: string;
  effort: string;
}
export interface SystemReview {
  id: string;
  period_start: string;
  period_end: string;
  metrics: Record<string, unknown>;
  headline: string | null;
  summary: string | null;
  recommendations: ReviewRec[];
  generated_by: 'ai' | 'fallback';
  model: string | null;
  status: 'new' | 'read' | 'archived';
  created_at: string;
}

export const aiReviewApi = {
  async list(limit = 12): Promise<SystemReview[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('system_reviews')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as SystemReview[];
  },

  /** Fire the monthly-review edge fn on demand. Async/fire-and-forget —
   *  the new row appears a few seconds later; the caller polls list(). */
  async generateNow(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc('agent_request_monthly_review');
    if (error) throw error;
  },

  async markRead(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('system_reviews')
      .update({ status: 'read' })
      .eq('id', id);
    if (error) throw error;
  },
};
