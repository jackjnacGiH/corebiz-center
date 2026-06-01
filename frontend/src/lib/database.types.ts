export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.4" }
  public: {
    Tables: {
      abandoned_carts: {
        Row: {
          cart_data: Json; cart_value: number; created_at: string; customer_id: string | null;
          email: string | null; id: string; last_reminder_at: string | null; recovered: boolean;
          recovered_order_id: string | null; reminder_count: number; updated_at: string;
        }
        Insert: {
          cart_data: Json; cart_value?: number; created_at?: string; customer_id?: string | null;
          email?: string | null; id?: string; last_reminder_at?: string | null; recovered?: boolean;
          recovered_order_id?: string | null; reminder_count?: number; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['abandoned_carts']['Insert']>
        Relationships: []
      }
      agent_links: {
        Row: {
          agent_id: string; campaign_id: string | null; clicks: number; conversions: number;
          created_at: string; destination_url: string; id: string; is_active: boolean;
          label: string | null; revenue: number; short_code: string;
        }
        Insert: {
          agent_id: string; campaign_id?: string | null; clicks?: number; conversions?: number;
          created_at?: string; destination_url: string; id?: string; is_active?: boolean;
          label?: string | null; revenue?: number; short_code: string;
        }
        Update: Partial<Database['public']['Tables']['agent_links']['Insert']>
        Relationships: []
      }
      agent_payouts: {
        Row: {
          agent_id: string; commission_count: number; created_at: string; id: string;
          method: string | null; notes: string | null; paid_at: string | null;
          reference: string | null; status: string; total_amount: number;
        }
        Insert: {
          agent_id: string; commission_count: number; created_at?: string; id?: string;
          method?: string | null; notes?: string | null; paid_at?: string | null;
          reference?: string | null; status?: string; total_amount: number;
        }
        Update: Partial<Database['public']['Tables']['agent_payouts']['Insert']>
        Relationships: []
      }
      agents: {
        Row: {
          approved_at: string | null; bank_account: Json | null; code: string;
          commission_rate: number; created_at: string; email: string | null; id: string;
          joined_at: string; name: string; notes: string | null; pending_commission: number;
          phone: string | null; status: string; tier: string; total_clicks: number;
          total_commission: number; total_conversions: number; total_sales: number;
          updated_at: string; user_id: string | null;
        }
        Insert: {
          approved_at?: string | null; bank_account?: Json | null; code: string;
          commission_rate?: number; created_at?: string; email?: string | null; id?: string;
          joined_at?: string; name: string; notes?: string | null; pending_commission?: number;
          phone?: string | null; status?: string; tier?: string; total_clicks?: number;
          total_commission?: number; total_conversions?: number; total_sales?: number;
          updated_at?: string; user_id?: string | null;
        }
        Update: Partial<Database['public']['Tables']['agents']['Insert']>
        Relationships: []
      }
      campaigns: {
        Row: {
          config: Json; created_at: string; created_by: string | null; description: string | null;
          ends_at: string | null; id: string; metrics: Json; name: string;
          starts_at: string | null; status: string; type: string; updated_at: string;
        }
        Insert: {
          config?: Json; created_at?: string; created_by?: string | null; description?: string | null;
          ends_at?: string | null; id?: string; metrics?: Json; name: string;
          starts_at?: string | null; status?: string; type?: string; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['campaigns']['Insert']>
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string; description: string | null; icon: string | null; id: string;
          is_active: boolean; name_en: string | null; name_th: string; parent_id: string | null;
          slug: string; sort_order: number | null; updated_at: string;
        }
        Insert: {
          created_at?: string; description?: string | null; icon?: string | null; id?: string;
          is_active?: boolean; name_en?: string | null; name_th: string; parent_id?: string | null;
          slug: string; sort_order?: number | null; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['categories']['Insert']>
        Relationships: []
      }
      chat_conversations: {
        Row: {
          assigned_to: string | null; avatar_url: string | null; channel: string; created_at: string;
          customer_id: string | null; display_name: string; external_id: string | null; id: string;
          last_message_at: string | null; last_message_preview: string | null; metadata: Json;
          sentiment: string | null; status: string; tags: string[]; unread_count: number; updated_at: string;
        }
        Insert: {
          assigned_to?: string | null; avatar_url?: string | null; channel: string; created_at?: string;
          customer_id?: string | null; display_name: string; external_id?: string | null; id?: string;
          last_message_at?: string | null; last_message_preview?: string | null; metadata?: Json;
          sentiment?: string | null; status?: string; tags?: string[]; unread_count?: number; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['chat_conversations']['Insert']>
        Relationships: []
      }
      chat_messages: {
        Row: {
          attachments: Json; content: string; content_type: string; conversation_id: string;
          created_at: string; external_msg_id: string | null; id: string; metadata: Json;
          read_at: string | null; sender_id: string | null; sender_name: string | null; sender_type: string;
        }
        Insert: {
          attachments?: Json; content: string; content_type?: string; conversation_id: string;
          created_at?: string; external_msg_id?: string | null; id?: string; metadata?: Json;
          read_at?: string | null; sender_id?: string | null; sender_name?: string | null; sender_type: string;
        }
        Update: Partial<Database['public']['Tables']['chat_messages']['Insert']>
        Relationships: []
      }
      chat_quick_reply_templates: {
        Row: {
          category: string | null; content: string; created_at: string; created_by: string | null;
          id: string; is_favorite: boolean; sort_order: number; title: string; updated_at: string;
        }
        Insert: {
          category?: string | null; content: string; created_at?: string; created_by?: string | null;
          id?: string; is_favorite?: boolean; sort_order?: number; title: string; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['chat_quick_reply_templates']['Insert']>
        Relationships: []
      }
      commissions: {
        Row: {
          agent_id: string; agent_link_id: string | null; amount: number; approved_at: string | null;
          created_at: string; id: string; note: string | null; order_id: string; order_total: number;
          paid_at: string | null; payout_id: string | null; rate: number; status: string; updated_at: string;
        }
        Insert: {
          agent_id: string; agent_link_id?: string | null; amount: number; approved_at?: string | null;
          created_at?: string; id?: string; note?: string | null; order_id: string; order_total: number;
          paid_at?: string | null; payout_id?: string | null; rate: number; status?: string; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['commissions']['Insert']>
        Relationships: []
      }
      coupons: {
        Row: {
          applies_to: Json; campaign_id: string | null; code: string; created_at: string;
          description: string | null; discount_type: string; discount_value: number; id: string;
          max_uses: number | null; min_purchase: number; per_customer_limit: number | null;
          status: string; updated_at: string; used_count: number;
          valid_from: string | null; valid_until: string | null;
        }
        Insert: {
          applies_to?: Json; campaign_id?: string | null; code: string; created_at?: string;
          description?: string | null; discount_type: string; discount_value?: number; id?: string;
          max_uses?: number | null; min_purchase?: number; per_customer_limit?: number | null;
          status?: string; updated_at?: string; used_count?: number;
          valid_from?: string | null; valid_until?: string | null;
        }
        Update: Partial<Database['public']['Tables']['coupons']['Insert']>
        Relationships: []
      }
      customers: {
        Row: {
          billing_address: Json | null; code: string | null; contact_name: string | null;
          created_at: string; customer_type: string; email: string | null; fax: string | null;
          id: string; loyalty_points: number; mobile: string | null; name: string; notes: string | null;
          phone: string | null; shipping_address: Json | null; source_channel: string | null;
          tags: string[]; tax_id: string | null; tier: string; total_orders: number; total_spent: number;
          updated_at: string; user_id: string | null; last_reorder_reminder_at: string | null;
          last_winback_at: string | null;
        }
        Insert: {
          billing_address?: Json | null; code?: string | null; contact_name?: string | null;
          created_at?: string; customer_type?: string; email?: string | null; fax?: string | null;
          id?: string; loyalty_points?: number; mobile?: string | null; name: string; notes?: string | null;
          phone?: string | null; shipping_address?: Json | null; source_channel?: string | null;
          tags?: string[]; tax_id?: string | null; tier?: string; total_orders?: number; total_spent?: number;
          updated_at?: string; user_id?: string | null; last_reorder_reminder_at?: string | null;
          last_winback_at?: string | null;
        }
        Update: Partial<Database['public']['Tables']['customers']['Insert']>
        Relationships: []
      }
      customer_branches: {
        Row: {
          address: Json | null; branch_code: string; branch_name: string;
          created_at: string; customer_id: string; id: string; notes: string | null;
          sort_order: number; updated_at: string;
        }
        Insert: {
          address?: Json | null; branch_code: string; branch_name: string;
          created_at?: string; customer_id: string; id?: string; notes?: string | null;
          sort_order?: number; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['customer_branches']['Insert']>
        Relationships: []
      }
      knowledge_categories: {
        Row: {
          id: string; value: string; label: string; sort_order: number;
          created_at: string; updated_at: string;
        }
        Insert: {
          id?: string; value: string; label: string; sort_order?: number;
          created_at?: string; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['knowledge_categories']['Insert']>
        Relationships: []
      }
      inventory: {
        Row: {
          id: string; product_id: string; quantity: number; reorder_level: number; reserved: number;
          row_no: string | null; shelf: string | null; updated_at: string;
          last_synced_at: string | null;
          variant_id: string | null; warehouse_id: string;
        }
        Insert: {
          id?: string; product_id: string; quantity?: number; reorder_level?: number; reserved?: number;
          row_no?: string | null; shelf?: string | null; updated_at?: string;
          last_synced_at?: string | null;
          variant_id?: string | null; warehouse_id: string;
        }
        Update: Partial<Database['public']['Tables']['inventory']['Insert']>
        Relationships: []
      }
      inventory_sync_logs: {
        Row: {
          id: string; started_at: string; finished_at: string | null;
          source: string; sheet_rows: number; matched: number; updated: number; skipped: number;
          status: string; error: string | null; details: Json | null;
        }
        Insert: {
          id?: string; started_at?: string; finished_at?: string | null;
          source: string; sheet_rows?: number; matched?: number; updated?: number; skipped?: number;
          status?: string; error?: string | null; details?: Json | null;
        }
        Update: Partial<Database['public']['Tables']['inventory_sync_logs']['Insert']>
        Relationships: []
      }
      inventory_movements: {
        Row: {
          created_at: string; created_by: string | null; id: string; movement_type: string;
          note: string | null; product_id: string; quantity: number; reference_id: string | null;
          reference_type: string | null; variant_id: string | null; warehouse_id: string;
        }
        Insert: {
          created_at?: string; created_by?: string | null; id?: string; movement_type: string;
          note?: string | null; product_id: string; quantity: number; reference_id?: string | null;
          reference_type?: string | null; variant_id?: string | null; warehouse_id: string;
        }
        Update: Partial<Database['public']['Tables']['inventory_movements']['Insert']>
        Relationships: []
      }
      knowledge_chunks: {
        Row: {
          category: string; chunk_index: number; content: string; content_hash: string; created_at: string;
          embedding: string | null; id: string; language: string; metadata: Json;
          source_path: string; source_type: string; tags: string[]; title: string | null;
          token_count: number | null; updated_at: string; visibility: string;
        }
        Insert: {
          category?: string; chunk_index?: number; content: string; content_hash: string; created_at?: string;
          embedding?: string | null; id?: string; language?: string; metadata?: Json;
          source_path: string; source_type?: string; tags?: string[]; title?: string | null;
          token_count?: number | null; updated_at?: string; visibility?: string;
        }
        Update: Partial<Database['public']['Tables']['knowledge_chunks']['Insert']>
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          created_at: string; customer_id: string; id: string; note: string | null;
          points: number; reason: string; reference_id: string | null; reference_type: string | null;
        }
        Insert: {
          created_at?: string; customer_id: string; id?: string; note?: string | null;
          points: number; reason: string; reference_id?: string | null; reference_type?: string | null;
        }
        Update: Partial<Database['public']['Tables']['loyalty_transactions']['Insert']>
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string; discount: number; id: string; order_id: string; product_id: string;
          product_name: string; quantity: number; sku: string; total: number; unit_price: number;
          variant_id: string | null;
        }
        Insert: {
          created_at?: string; discount?: number; id?: string; order_id: string; product_id: string;
          product_name: string; quantity: number; sku: string; total: number; unit_price: number;
          variant_id?: string | null;
        }
        Update: Partial<Database['public']['Tables']['order_items']['Insert']>
        Relationships: []
      }
      orders: {
        Row: {
          carrier: string | null; channel: string; code: string; created_at: string;
          created_by: string | null; customer_id: string | null; discount: number; id: string;
          internal_notes: string | null; notes: string | null; payment_method: string | null;
          payment_status: string; shipping_address: Json | null; shipping_fee: number; status: string;
          subtotal: number; total: number; tracking_no: string | null; updated_at: string; vat: number;
        }
        Insert: {
          carrier?: string | null; channel?: string; code: string; created_at?: string;
          created_by?: string | null; customer_id?: string | null; discount?: number; id?: string;
          internal_notes?: string | null; notes?: string | null; payment_method?: string | null;
          payment_status?: string; shipping_address?: Json | null; shipping_fee?: number; status?: string;
          subtotal?: number; total?: number; tracking_no?: string | null; updated_at?: string; vat?: number;
        }
        Update: Partial<Database['public']['Tables']['orders']['Insert']>
        Relationships: []
      }
      page_sections: {
        Row: { content: string | null; embedding: string | null; id: number; metadata: Json | null }
        Insert: { content?: string | null; embedding?: string | null; id?: number; metadata?: Json | null }
        Update: { content?: string | null; embedding?: string | null; id?: number; metadata?: Json | null }
        Relationships: []
      }
      product_variants: {
        Row: {
          attributes: Json; barcode: string | null; created_at: string; id: string;
          is_active: boolean; name: string; price_diff: number; product_id: string; sku: string;
        }
        Insert: {
          attributes?: Json; barcode?: string | null; created_at?: string; id?: string;
          is_active?: boolean; name: string; price_diff?: number; product_id: string; sku: string;
        }
        Update: Partial<Database['public']['Tables']['product_variants']['Insert']>
        Relationships: []
      }
      notifications: {
        Row: {
          id: string;
          recipient_id: string | null;
          type: 'order' | 'customer' | 'inventory' | 'system';
          title: string;
          body: string;
          link: string | null;
          metadata: Json;
          read_at: string | null;
          created_at: string;
        }
        Insert: {
          id?: string;
          recipient_id?: string | null;
          type: 'order' | 'customer' | 'inventory' | 'system';
          title: string;
          body: string;
          link?: string | null;
          metadata?: Json;
          read_at?: string | null;
          created_at?: string;
        }
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null; brand: string | null; category_id: string | null;
          cost: number | null; created_at: string; description_en: string | null;
          description_th: string | null; discount_type: string; discount_value: number;
          feature_tags: string[]; group_id: string | null; id: string;
          images: Json; is_featured: boolean;
          min_order_qty: number;
          name_en: string | null; name_th: string; price: number; sku: string; spec: Json;
          status: string; tags: string[]; unit: string; updated_at: string; weight_kg: number | null;
        }
        Insert: {
          barcode?: string | null; brand?: string | null; category_id?: string | null;
          cost?: number | null; created_at?: string; description_en?: string | null;
          description_th?: string | null; discount_type?: string; discount_value?: number;
          feature_tags?: string[]; group_id?: string | null; id?: string;
          images?: Json; is_featured?: boolean;
          min_order_qty?: number;
          name_en?: string | null; name_th: string; price?: number; sku: string; spec?: Json;
          status?: string; tags?: string[]; unit?: string; updated_at?: string; weight_kg?: number | null;
        }
        Update: Partial<Database['public']['Tables']['products']['Insert']>
        Relationships: []
      }
      product_groups: {
        Row: {
          id: string; name: string; description: string | null; cover_image: string | null;
          sort_order: number; is_active: boolean; created_at: string; updated_at: string;
        }
        Insert: {
          id?: string; name: string; description?: string | null; cover_image?: string | null;
          sort_order?: number; is_active?: boolean; created_at?: string; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['product_groups']['Insert']>
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null; created_at: string; email: string; full_name: string | null;
          id: string; is_active: boolean; language: string; line_user_id: string | null;
          notification_prefs: Json;
          phone: string | null; provider: string | null; role: string; updated_at: string;
        }
        Insert: {
          avatar_url?: string | null; created_at?: string; email: string; full_name?: string | null;
          id: string; is_active?: boolean; language?: string; line_user_id?: string | null;
          notification_prefs?: Json;
          phone?: string | null; provider?: string | null; role?: string; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
        Relationships: []
      }
      org_settings: {
        Row: {
          id: boolean;
          business_name: string | null;
          tax_id: string | null;
          timezone: string;
          currency: string;
          address: string | null;
          phone: string | null;
          email: string | null;
          website: string | null;
          updated_at: string;
          updated_by: string | null;
        }
        Insert: {
          id?: boolean;
          business_name?: string | null;
          tax_id?: string | null;
          timezone?: string;
          currency?: string;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          website?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        }
        Update: Partial<Database['public']['Tables']['org_settings']['Insert']>
        Relationships: []
      }
      quote_items: {
        Row: {
          discount: number; id: string; product_id: string; product_name: string;
          quantity: number; quote_id: string; sku: string; total: number; unit_price: number;
          variant_id: string | null;
        }
        Insert: {
          discount?: number; id?: string; product_id: string; product_name: string;
          quantity: number; quote_id: string; sku: string; total: number; unit_price: number;
          variant_id?: string | null;
        }
        Update: Partial<Database['public']['Tables']['quote_items']['Insert']>
        Relationships: []
      }
      quotes: {
        Row: {
          code: string; converted_to_order_id: string | null; created_at: string;
          created_by: string | null; customer_id: string | null; discount: number; id: string;
          notes: string | null; status: string; subtotal: number; total: number;
          updated_at: string; valid_until: string | null; vat: number;
          last_followup_at: string | null;
        }
        Insert: {
          code: string; converted_to_order_id?: string | null; created_at?: string;
          created_by?: string | null; customer_id?: string | null; discount?: number; id?: string;
          notes?: string | null; status?: string; subtotal?: number; total?: number;
          updated_at?: string; valid_until?: string | null; vat?: number;
          last_followup_at?: string | null;
        }
        Update: Partial<Database['public']['Tables']['quotes']['Insert']>
        Relationships: []
      }
      warehouses: {
        Row: {
          address: string | null; code: string; created_at: string; id: string;
          is_active: boolean; is_default: boolean; name: string;
        }
        Insert: {
          address?: string | null; code: string; created_at?: string; id?: string;
          is_active?: boolean; is_default?: boolean; name: string;
        }
        Update: Partial<Database['public']['Tables']['warehouses']['Insert']>
        Relationships: []
      }
      line_channels: {
        Row: {
          id: string; name: string; channel_id: string | null;
          channel_access_token: string; channel_secret: string;
          is_active: boolean; notes: string | null;
          created_at: string; updated_at: string;
        }
        Insert: {
          id?: string; name: string; channel_id?: string | null;
          channel_access_token: string; channel_secret: string;
          is_active?: boolean; notes?: string | null;
          created_at?: string; updated_at?: string;
        }
        Update: Partial<Database['public']['Tables']['line_channels']['Insert']>
        Relationships: []
      }
      ai_personas: {
        Row: {
          id: string; channel: string; display_name: string; prompt: string;
          updated_at: string; updated_by: string | null;
        }
        Insert: {
          id?: string; channel: string; display_name: string; prompt: string;
          updated_at?: string; updated_by?: string | null;
        }
        Update: Partial<Database['public']['Tables']['ai_personas']['Insert']>
        Relationships: []
      }
    }
    Views: {}
    Functions: {
      is_owner: { Args: Record<string, never>; Returns: boolean }
      is_staff: { Args: Record<string, never>; Returns: boolean }
      adjust_loyalty_points: {
        Args: { p_customer_id: string; p_points: number; p_note?: string | null }
        Returns: number
      }
      redeem_loyalty_points: {
        Args: { p_customer_id: string; p_points: number; p_discount: number; p_label?: string | null }
        Returns: { coupon_code: string; new_balance: number }[]
      }
      issue_coupon: {
        Args: { p_discount: number; p_label?: string | null }
        Returns: string
      }
      match_knowledge: {
        Args: {
          query_embedding: string; match_threshold?: number; match_count?: number;
          filter_language?: string; filter_visibility?: string;
        }
        Returns: Array<{
          id: string; title: string | null; content: string; source_path: string;
          metadata: Json; tags: string[]; similarity: number;
        }>
      }
      recalculate_customer_totals: { Args: { p_customer_id: string }; Returns: undefined }
      trigger_inventory_sync: { Args: Record<string, never>; Returns: number }
      set_api_secret: { Args: { p_name: string; p_value: string }; Returns: undefined }
      get_api_secret_preview: { Args: { p_name: string }; Returns: string | null }
      delete_api_secret: { Args: { p_name: string }; Returns: undefined }
    }
    Enums: {}
    CompositeTypes: {}
  }
}

// Convenience exports
export type Product   = Database['public']['Tables']['products']['Row']
export type ProductInsert = Database['public']['Tables']['products']['Insert']
export type ProductUpdate = Database['public']['Tables']['products']['Update']

export type ProductGroup       = Database['public']['Tables']['product_groups']['Row']
export type ProductGroupInsert = Database['public']['Tables']['product_groups']['Insert']
export type ProductGroupUpdate = Database['public']['Tables']['product_groups']['Update']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type OrgSettings = Database['public']['Tables']['org_settings']['Row']
export type OrgSettingsUpdate = Database['public']['Tables']['org_settings']['Update']

export type AiPersonaRow    = Database['public']['Tables']['ai_personas']['Row']
export type AiPersonaInsert = Database['public']['Tables']['ai_personas']['Insert']
export type AiPersonaUpdate = Database['public']['Tables']['ai_personas']['Update']

export type Category  = Database['public']['Tables']['categories']['Row']
export type Warehouse = Database['public']['Tables']['warehouses']['Row']

export type Inventory       = Database['public']['Tables']['inventory']['Row']
export type InventoryInsert = Database['public']['Tables']['inventory']['Insert']
export type InventoryUpdate = Database['public']['Tables']['inventory']['Update']

export type Customer        = Database['public']['Tables']['customers']['Row']
export type CustomerInsert  = Database['public']['Tables']['customers']['Insert']
export type CustomerUpdate  = Database['public']['Tables']['customers']['Update']

export type CustomerBranch       = Database['public']['Tables']['customer_branches']['Row']
export type CustomerBranchInsert = Database['public']['Tables']['customer_branches']['Insert']
export type CustomerBranchUpdate = Database['public']['Tables']['customer_branches']['Update']

export type Order        = Database['public']['Tables']['orders']['Row']
export type OrderInsert  = Database['public']['Tables']['orders']['Insert']
export type OrderUpdate  = Database['public']['Tables']['orders']['Update']

export type OrderItem        = Database['public']['Tables']['order_items']['Row']
export type OrderItemInsert  = Database['public']['Tables']['order_items']['Insert']

export type Quote               = Database['public']['Tables']['quotes']['Row']
export type LoyaltyTransaction  = Database['public']['Tables']['loyalty_transactions']['Row']
