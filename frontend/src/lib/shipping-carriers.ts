export interface ShippingCarrierBrand {
  name: string;
  shortName: string;
  accent: string;
  logoUrl?: string;
}

const BRANDS: Array<[RegExp, ShippingCarrierBrand]> = [
  [
    /^FLASH/,
    {
      name: "Flash Express",
      shortName: "FLASH",
      accent: "#f5a400",
    },
  ],
  [/^BEST/, { name: "Best Express", shortName: "BEST", accent: "#e1251b" }],
  [
    /^KEX|^KERRY/,
    {
      name: "KEX Express",
      shortName: "KEX",
      accent: "#f37021",
      logoUrl: "https://th.kex-express.com/images/logo.png",
    },
  ],
  [
    /^J&T/,
    {
      name: "J&T Express",
      shortName: "J&T",
      accent: "#d71920",
      logoUrl: "https://www.jtexpress.com/icons/logo.png",
    },
  ],
  [
    /^EMS|^POSTSABUY|^THAIPOST/,
    {
      name: "Thailand Post",
      shortName: "THP",
      accent: "#d61f2c",
      logoUrl:
        "https://www.thailandpost.co.th/library/template/thailandpost/standard5/theme/images/logo-thailandpost-hor.png",
    },
  ],
  [/^DHL/, { name: "DHL Express", shortName: "DHL", accent: "#d40511" }],
  [
    /^SPX|^SHOPEE/,
    {
      name: "SPX Express",
      shortName: "SPX",
      accent: "#ee4d2d",
      logoUrl: "https://spx.co.th/logo/spx-express.svg",
    },
  ],
  [
    /^LAZADA/,
    { name: "Lazada Logistics", shortName: "LEX", accent: "#111c4e" },
  ],
  [/^RTT/, { name: "RTT Express", shortName: "RTT", accent: "#1769aa" }],
];

export const SHIPPING_CARRIER_OPTIONS = [
  ["FLASH_EXPRESS_SPEED", "Flash Express"],
  ["FLASHBULKY_SPEED", "Flash Bulky"],
  ["BEST_EXPRESS_SPEED", "Best Express"],
  ["KEX_SPEED", "KEX Express"],
  ["KEXONLINE_SPEED", "KEX Online"],
  ["KEXFRUIT_SPEED", "KEX Fruit"],
  ["J&T_EXPRESS_SPEED", "J&T Express"],
  ["EMS_SPEED", "Thailand Post EMS"],
  ["POSTSABUY_SPEED", "Post Sabuy"],
  ["POSTSABUYFRUIT_SPEED", "Post Sabuy Fruit"],
  ["DHL_SPEED", "DHL Express"],
  ["DHLECO_SPEED", "DHL eCommerce"],
  ["SPX_SPEED", "SPX Express"],
  ["LAZADA_EXPRESS_SPEED", "Lazada Logistics"],
  ["RTT_SPEED", "RTT Express"],
] as const;

export function shippingCarrierBrand(code: string): ShippingCarrierBrand {
  const normalized = code.trim().toUpperCase();
  const found = BRANDS.find(([pattern]) => pattern.test(normalized));
  return (
    found?.[1] ?? {
      name: normalized || "ยังไม่เลือกขนส่ง",
      shortName: normalized
        ? normalized.replace(/[_-].*$/, "").slice(0, 8)
        : "CARRIER",
      accent: "#111827",
    }
  );
}
