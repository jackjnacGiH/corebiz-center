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
      logoUrl: "/center/shipping-carriers/flash.svg",
    },
  ],
  [
    /^BEST/,
    {
      name: "Best Express",
      shortName: "BEST",
      accent: "#e1251b",
      logoUrl: "/center/shipping-carriers/best.png",
    },
  ],
  [
    /^KEX|^KERRY/,
    {
      name: "KEX Express",
      shortName: "KEX",
      accent: "#f37021",
      logoUrl: "/center/shipping-carriers/kex.png",
    },
  ],
  [
    /^J&T/,
    {
      name: "J&T Express",
      shortName: "J&T",
      accent: "#d71920",
      logoUrl: "/center/shipping-carriers/jnt.png",
    },
  ],
  [
    /^EMS|^POSTSABUY|^THAIPOST/,
    {
      name: "Thailand Post",
      shortName: "THP",
      accent: "#d61f2c",
      logoUrl: "/center/shipping-carriers/thailand-post.png",
    },
  ],
  [
    /^DHL/,
    {
      name: "DHL Express",
      shortName: "DHL",
      accent: "#d40511",
      logoUrl: "/center/shipping-carriers/dhl.svg",
    },
  ],
  [
    /^SPX|^SHOPEE/,
    {
      name: "SPX Express",
      shortName: "SPX",
      accent: "#ee4d2d",
      logoUrl: "/center/shipping-carriers/spx.svg",
    },
  ],
  [
    /^LAZADA/,
    {
      name: "Lazada Logistics",
      shortName: "LEX",
      accent: "#111c4e",
      logoUrl: "/center/shipping-carriers/lazada.svg",
    },
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

/**
 * Public carrier tracking pages. The query forms are limited to URLs accepted
 * by the carriers' public websites; pages without a stable prefill contract
 * still open the correct public tracking form.
 */
export function shippingTrackingUrl(
  carrierCode: string,
  trackingNumber: string,
): string | null {
  const carrier = carrierCode.trim().toUpperCase();
  const tracking = trackingNumber.trim();
  if (!carrier || !/^[A-Za-z0-9-]{5,80}$/.test(tracking)) return null;
  const value = encodeURIComponent(tracking);
  if (/^FLASH/.test(carrier))
    return `https://www.flashexpress.co.th/fle/tracking?se=${value}`;
  if (/^BEST/.test(carrier))
    return `https://www.best-inc.co.th/track?waybill=${value}`;
  if (/^KEX|^KERRY/.test(carrier))
    return `https://th.kex-express.com/th/track/?action=search&code=${value}`;
  if (/^J&T/.test(carrier))
    return `https://www.jtexpress.co.th/service/track?waybillNo=${value}`;
  if (/^EMS|^POSTSABUY|^THAIPOST/.test(carrier))
    return "https://track.thailandpost.co.th/";
  if (/^DHL/.test(carrier))
    return `https://www.dhl.com/th-th/home/tracking.html?awb=${value}&brand=dhl`;
  if (/^SPX|^SHOPEE/.test(carrier)) return "https://spx.co.th/th";
  if (/^LAZADA/.test(carrier))
    return "https://www.lazada.co.th/helpcenter/where-is-my-order.html";
  return null;
}
