import { createContext, useContext } from 'react';

export type Language = 'th' | 'en';

export const translations = {
  en: {
    common: {
      languageLabel: 'Language',
      thai: 'TH',
      english: 'EN',
    },
    layout: {
      sidebarSubtitle: 'Commerce operations',
      systemSettings: 'System settings',
      searchPlaceholder: 'Search orders, products, customers...',
      help: 'Help',
      notifications: 'Notifications',
      adminWorkspace: 'Admin workspace',
    },
    nav: {
      dashboard: 'Dashboard',
      ecommerce: 'E-Commerce',
      inventory: 'Inventory',
      orders: 'Orders',
      crm: 'CRM & Customers',
      chat: 'Omni-Chat',
      marketing: 'Marketing & Affiliates',
      affiliate: 'Affiliate',
      rag: 'Openclaw RAG',
      jnac: 'JNAC Admin Chat',
    },
    ecommerce: {
      eyebrow: 'B2B Commerce Workspace',
      title: 'Industrial Product Catalog',
      description:
        'Manage product availability, quote baskets, and sales-ready catalog items for abrasive, cutting, grinding, and pneumatic tool customers.',
      openQuoteCart: 'Open quote cart',
      quoteCart: 'Quote Cart',
      overview: 'Commerce overview',
      products: 'Products',
      inventoryValue: 'Inventory value',
      quoteItems: 'Quote items',
      lowStock: 'Low stock',
      searchPlaceholder: 'Search product name, SKU, or brand',
      categoriesLabel: 'Product categories',
      filters: 'Filters',
      moreFilters: 'More filters',
      productShelf: 'Product shelf',
      itemsMatched: 'items matched',
      viewMode: 'View mode',
      grid: 'Grid',
      table: 'Table',
      available: 'available',
      addToQuote: 'Add to quote',
      noProducts: 'No products found',
      noProductsHint: 'Try another SKU, brand, or category.',
      closeQuoteCart: 'Close quote cart',
      quoteBasket: 'Quote basket',
      selectedItems: 'selected items',
      closeCart: 'Close cart',
      emptyCart: 'Your quote cart is empty',
      emptyCartHint: 'Add products from the catalog to prepare a quotation.',
      decreaseQuantity: 'Decrease quantity',
      increaseQuantity: 'Increase quantity',
      removeItem: 'Remove item',
      subtotal: 'Subtotal',
      vat: 'VAT 7%',
      grandTotal: 'Grand total',
      createQuotation: 'Create quotation',
      continueBrowsing: 'Continue browsing',
      stock: {
        ready: 'Ready',
        watch: 'Watch',
        low: 'Low stock',
      },
      leadTimes: {
        ready: 'Ready to ship',
        twoThreeDays: '2-3 days',
        low: 'Limited stock',
      },
      categories: {
        all: 'All',
        abrasives: 'Abrasives',
        cutting: 'Cutting',
        grinding: 'Grinding',
        polishing: 'Polishing',
        pneumaticTools: 'Pneumatic Tools',
        safety: 'Safety',
      },
      units: {
        pcs: 'pcs',
        set: 'set',
        pair: 'pair',
        roll: 'roll',
      },
    },
  },
  th: {
    common: {
      languageLabel: 'ภาษา',
      thai: 'TH',
      english: 'EN',
    },
    layout: {
      sidebarSubtitle: 'ศูนย์จัดการการขาย',
      systemSettings: 'ตั้งค่าระบบ',
      searchPlaceholder: 'ค้นหาคำสั่งซื้อ สินค้า หรือลูกค้า...',
      help: 'ช่วยเหลือ',
      notifications: 'การแจ้งเตือน',
      adminWorkspace: 'พื้นที่ผู้ดูแล',
    },
    nav: {
      dashboard: 'แดชบอร์ด',
      ecommerce: 'ร้านค้าออนไลน์',
      inventory: 'คลังสินค้า',
      orders: 'คำสั่งซื้อ',
      crm: 'ระบบลูกค้า',
      chat: 'แชทรวมช่องทาง',
      marketing: 'การตลาดและพาร์ทเนอร์',
      affiliate: 'พาร์ทเนอร์',
      rag: 'Openclaw RAG',
      jnac: 'แชทแอดมิน JNAC',
    },
    ecommerce: {
      eyebrow: 'พื้นที่จัดการขายส่งออนไลน์',
      title: 'แคตตาล็อกสินค้าอุตสาหกรรม',
      description:
        'จัดการสินค้า สต็อก ตะกร้าใบเสนอราคา และรายการพร้อมขายสำหรับลูกค้ากลุ่มงานขัด ตัด เจียร์ และเครื่องมือลม',
      openQuoteCart: 'เปิดตะกร้าใบเสนอราคา',
      quoteCart: 'ตะกร้าใบเสนอราคา',
      overview: 'ภาพรวมการขาย',
      products: 'สินค้า',
      inventoryValue: 'มูลค่าสต็อก',
      quoteItems: 'รายการในตะกร้า',
      lowStock: 'สต็อกต่ำ',
      searchPlaceholder: 'ค้นหาชื่อสินค้า SKU หรือแบรนด์',
      categoriesLabel: 'หมวดหมู่สินค้า',
      filters: 'ตัวกรอง',
      moreFilters: 'ตัวกรองเพิ่มเติม',
      productShelf: 'รายการสินค้า',
      itemsMatched: 'รายการที่ตรงกัน',
      viewMode: 'รูปแบบการแสดงผล',
      grid: 'กริด',
      table: 'ตาราง',
      available: 'พร้อมขาย',
      addToQuote: 'เพิ่มลงใบเสนอราคา',
      noProducts: 'ไม่พบสินค้า',
      noProductsHint: 'ลองค้นหาด้วย SKU แบรนด์ หรือหมวดหมู่อื่น',
      closeQuoteCart: 'ปิดตะกร้าใบเสนอราคา',
      quoteBasket: 'ตะกร้าใบเสนอราคา',
      selectedItems: 'รายการที่เลือก',
      closeCart: 'ปิดตะกร้า',
      emptyCart: 'ยังไม่มีสินค้าในตะกร้า',
      emptyCartHint: 'เพิ่มสินค้าจากแคตตาล็อกเพื่อเตรียมใบเสนอราคา',
      decreaseQuantity: 'ลดจำนวน',
      increaseQuantity: 'เพิ่มจำนวน',
      removeItem: 'ลบรายการ',
      subtotal: 'ยอดรวมสินค้า',
      vat: 'ภาษี 7%',
      grandTotal: 'ยอดสุทธิ',
      createQuotation: 'สร้างใบเสนอราคา',
      continueBrowsing: 'เลือกสินค้าต่อ',
      stock: {
        ready: 'พร้อมขาย',
        watch: 'ต้องติดตาม',
        low: 'สต็อกต่ำ',
      },
      leadTimes: {
        ready: 'พร้อมส่ง',
        twoThreeDays: '2-3 วัน',
        low: 'เหลือน้อย',
      },
      categories: {
        all: 'ทั้งหมด',
        abrasives: 'งานขัด',
        cutting: 'งานตัด',
        grinding: 'งานเจียร์',
        polishing: 'งานปัดเงา',
        pneumaticTools: 'เครื่องมือลม',
        safety: 'อุปกรณ์เซฟตี้',
      },
      units: {
        pcs: 'ชิ้น',
        set: 'ชุด',
        pair: 'คู่',
        roll: 'ม้วน',
      },
    },
  },
} as const;

export type TranslationSet = (typeof translations)[Language];

export interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: TranslationSet;
}

export const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage must be used inside LanguageProvider');
  }

  return context;
}
