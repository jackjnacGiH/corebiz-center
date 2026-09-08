// Local preview only. Not imported by the production application.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { LanguageContext, translations } from "../src/i18n";
import Shipping from "../src/pages/Shipping";
import { shippingApi } from "../src/lib/shipping-api";
import {
  emptyDraft,
  emptyAddress,
  parseDraft,
} from "../../supabase/functions/_shared/shipping-domain";
import "../src/index.css";

const key = "corebiz-shipping-local-demo-v1";
const uid = "00000000-0000-4000-8000-000000000001";
const oid = "00000000-0000-4000-8000-000000000002";
let state;
try {
  state = JSON.parse(localStorage.getItem(key));
} catch {}
state ??= {
  rows: [],
  settings: {
    environment: "uat",
    billing_mode: "unconfirmed",
    merchant_code: "DEMO",
    origin: {
      ...emptyAddress(),
      fullname: "บริษัท เจ แนค (ประเทศไทย) จำกัด",
      address: "99/9 ถนนตัวอย่าง",
      county: "บางนาเหนือ",
      city: "บางนา",
      state: "กรุงเทพมหานคร",
      postcode: "10260",
      email: "demo@example.invalid",
      telephone1: "020000000",
    },
  },
  accounts: [],
  grants: [],
};
if (!Array.isArray(state.rows) || state.rows.length === 0) {
  const draft = emptyDraft();
  draft.purpose = "SO-DEMO-001";
  draft.origin = structuredClone(state.settings.origin);
  draft.destination = {
    ...emptyAddress(),
    fullname: "ลูกค้าทดลอง",
    address: "88/8 ถนนตัวอย่าง",
    county: "คลองหนึ่ง",
    city: "คลองหลวง",
    state: "ปทุมธานี",
    postcode: "12120",
    email: "customer@example.invalid",
    telephone1: "0800000000",
  };
  draft.carrier_code = "FLASH_EXPRESS_SPEED";
  draft.box_width = 25;
  draft.box_height = 20;
  draft.box_length = 35;
  draft.box_weight = 1200;
  draft.parcel_total = 3;
  draft.products = [
    {
      name: "สินค้าตัวอย่าง",
      code: "DEMO-SKU",
      qty: 2,
      price: "100.00",
      weight: 500,
    },
  ];
  state.rows = [
    {
      id: "00000000-0000-4000-8000-000000000003",
      reference_no: "DEMO-LABEL-001",
      order_id: oid,
      order_code: "SO-DEMO-001",
      draft,
      status: "draft",
      tracking_number: "DEMO8863354251",
      version: 1,
      created_by: uid,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
  localStorage.setItem(key, JSON.stringify(state));
}
const copy = (x) => structuredClone(x);
const persist = () => localStorage.setItem(key, JSON.stringify(state));
const disabled = async () => {
  throw new Error("provider_not_ready");
};
Object.assign(shippingApi, {
  bootstrap: async () =>
    copy({
      manager: true,
      brand: {
        name: "บริษัท เจ แนค (ประเทศไทย) จำกัด",
        logo_url:
          "https://owoedccmuqnzdtxvywgt.supabase.co/storage/v1/object/public/products/org/logo-1780575093630-4bg7c4.png",
      },
      settings: state.settings,
      accounts: state.accounts.filter((a) => a.active),
      readReady: false,
      sendReady: false,
    }),
  list: async (page, search) => {
    const rows = state.rows.filter((s) => s.reference_no.includes(search));
    return copy({
      shipments: rows.slice(page * 25, page * 25 + 25),
      count: rows.length,
    });
  },
  get: async (id) =>
    copy({ shipment: state.rows.find((s) => s.id === id), events: [] }),
  create: async (id, draft, order_id) => {
    let s = state.rows.find((s) => s.id === id);
    if (!s) {
      s = {
        id,
        reference_no: "DEMO-" + id,
        order_id,
        order_code: order_id ? "SO-DEMO-001" : null,
        draft: parseDraft(draft),
        status: "draft",
        tracking_number: "DEMO" + Date.now().toString().slice(-10),
        version: 1,
        created_by: uid,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.rows.unshift(s);
      persist();
    }
    return copy({ shipment: s });
  },
  save: async (s, draft) => {
    const old = state.rows.find((x) => x.id === s.id);
    if (old.version !== s.version) throw new Error("conflict");
    old.draft = parseDraft(draft);
    old.version++;
    persist();
    return copy({ shipment: old });
  },
  action: async (action, s) => {
    if (action !== "archive") return disabled();
    const old = state.rows.find((x) => x.id === s.id);
    if (old.version !== s.version) throw new Error("conflict");
    old.status = "archived";
    old.version++;
    persist();
    return copy({ shipment: old });
  },
  orderOptions: async () => ({ orders: [{ id: oid, code: "SO-DEMO-001" }] }),
  recipientOptions: async (search) => {
    const needle = String(search).trim().toLocaleLowerCase("th");
    const seen = new Set();
    const recipients = state.rows
      .map((shipment) => ({
        id: `history:${shipment.id}`,
        source: "history",
        address: shipment.draft.destination,
      }))
      .filter(({ address }) => {
        const text = Object.values(address).join(" ").toLocaleLowerCase("th");
        const key = `${address.fullname}|${address.telephone1}|${address.address}`;
        if (!text.includes(needle) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return copy({ recipients });
  },
  orderDraft: async () => {
    const draft = emptyDraft();
    draft.purpose = "SO-DEMO-001";
    draft.destination.fullname = "ลูกค้าทดลอง";
    draft.destination.address = "88/8 ถนนตัวอย่าง";
    draft.destination.county = "คลองหนึ่ง";
    draft.destination.city = "คลองหลวง";
    draft.destination.state = "ปทุมธานี";
    draft.destination.postcode = "12120";
    draft.destination.email = "customer@example.invalid";
    draft.destination.telephone1 = "0800000000";
    draft.carrier_code = "FLASH_EXPRESS_SPEED";
    draft.box_width = 25;
    draft.box_height = 20;
    draft.box_length = 35;
    draft.box_weight = 1200;
    draft.parcel_total = 3;
    draft.products = [
      {
        name: "สินค้าตัวอย่าง",
        code: "DEMO-SKU",
        qty: 2,
        price: "100.00",
        weight: 500,
      },
    ];
    return {
      draft,
      order_code: "SO-DEMO-001",
      previous: state.rows.filter((s) => s.order_id === oid),
    };
  },
  admin: async () =>
    copy({
      users: [
        { id: uid, full_name: "ผู้ดูแลทดลอง", role: "owner", is_active: true },
        { id: oid, full_name: "พนักงานทดลอง", role: "staff", is_active: true },
      ],
      grants: state.grants,
      accounts: state.accounts,
    }),
  saveSettings: async (settings) => {
    state.settings = copy(settings);
    persist();
  },
  permission: async (user_id, enabled) => {
    state.grants = state.grants.filter((g) => g.user_id !== user_id);
    if (enabled) state.grants.push({ user_id });
    persist();
  },
  saveCod: async (account) => {
    state.accounts = state.accounts.filter((a) => a.id !== account.id);
    state.accounts.push(copy(account));
    persist();
  },
  quote: disabled,
  print: disabled,
});
createRoot(document.getElementById("root")).render(
  <LanguageContext.Provider
    value={{ language: "th", setLanguage: () => {}, t: translations.th }}
  >
    <MemoryRouter>
      <main className="max-w-6xl mx-auto p-4 sm:p-8">
        <div className="mb-6 rounded-xl bg-amber-100 text-amber-950 p-4">
          <strong>CoreBiz — พื้นที่ทดลองขนส่ง</strong>
          <p>
            ใช้ข้อมูลจำลองเท่านั้น ร่างเก็บใน browser เครื่องนี้
            ไม่มีการส่งพัสดุ เติมเครดิต หรือแก้ข้อมูลบริษัทจริง
          </p>
        </div>
        <Shipping />
      </main>
    </MemoryRouter>
  </LanguageContext.Provider>,
);
