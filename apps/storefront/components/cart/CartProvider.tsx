"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

export interface CartItem {
  sku: string;
  name: string;
  price: number; // effective unit price
  unit: string | null;
  image: string | null;
  moq: number;
  qty: number;
}

interface CartCtx {
  items: CartItem[];
  count: number;
  subtotal: number;
  add: (item: Omit<CartItem, "qty">, qty?: number) => void;
  setQty: (sku: string, qty: number) => void;
  remove: (sku: string) => void;
  clear: () => void;
  open: boolean;
  setOpen: (b: boolean) => void;
}

const Ctx = createContext<CartCtx | null>(null);
const KEY = "corebiz_shop_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, [items, ready]);

  const add = useCallback((item: Omit<CartItem, "qty">, qty = 1) => {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.sku === item.sku);
      const step = Math.max(1, Math.floor(qty) || 1);
      if (i >= 0) {
        const copy = [...prev];
        copy[i] = { ...copy[i], qty: copy[i].qty + step };
        return copy;
      }
      return [...prev, { ...item, qty: Math.max(step, item.moq || 1) }];
    });
    setOpen(true);
  }, []);

  const setQty = useCallback((sku: string, qty: number) => {
    setItems((prev) =>
      prev.map((x) => (x.sku === sku ? { ...x, qty: Math.max(1, Math.floor(qty) || 1) } : x)),
    );
  }, []);

  const remove = useCallback((sku: string) => {
    setItems((prev) => prev.filter((x) => x.sku !== sku));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <Ctx.Provider value={{ items, count, subtotal, add, setQty, remove, clear, open, setOpen }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used within CartProvider");
  return c;
}
