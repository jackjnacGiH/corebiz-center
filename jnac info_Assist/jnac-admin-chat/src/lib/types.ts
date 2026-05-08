export type ProductRecord = {
  id: string;
  type: "product";
  product_code: string;
  name: string;
  category: string;
  description: string;
  unit: string;
  price: number | null;
  inventory_price: number | null;
  price_source: string;
  price_rule_id: string;
  price_rule_name: string;
  price_rule_grits: string[];
  stock: number | null;
  min_stock: number | null;
  availability: string;
  shelf: string;
  row: string;
  flowaccount_qty: number | null;
  embedding_text: string;
  answer_text: string;
  hashes?: {
    embedding_hash: string;
    live_hash: string;
    row_hash: string;
  };
};

export type PriceRule = {
  id: string;
  type: "price_rule";
  source_row: string;
  source_product_code: string;
  name: string;
  base_name: string;
  base_key: string;
  grits: string[];
  unit: string;
  price: number;
  detail: string;
  note: string;
  embedding_text: string;
  answer_text: string;
  hash: string;
};

export type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
};
