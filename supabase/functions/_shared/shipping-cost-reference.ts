import {
  moneyMinor,
  shippingParcels,
  type ShippingDraft,
  type ShippingParcel,
} from "./shipping-domain.ts";

// Internal source: ราคาทุนขนส่ง API+Corporate_1 page 16Apr26.pdf
// SHA-256: 95A1EC7C052246C6E9AFD11496FF7BFAC955C0A19A0DB515F4C15D012F973AF5
// The PDF states special-area fees but contains no postcode list, so the
// calculator exposes the surcharge as a conditional range instead of guessing.

export type ShippingCostExtraKind = "cod" | "pickup" | "special_area";
export interface ShippingCostReference {
  source: "pdf_2026_04";
  available: boolean;
  base: string | null;
  extras: { kind: ShippingCostExtraKind; amount: string; conditional: boolean }[];
  total: string | null;
  total_with_conditional: string | null;
  reason: "not_in_pdf" | "outside_pdf_conditions" | null;
}

type ZonePrices = readonly [number, number];
type DimensionTier = readonly [number, number, number];
type PdfService = {
  specialAreaFee: number;
  parcelPrice: (parcel: ShippingParcel, metro: boolean) => number | null;
  codRate?: number;
  codVat?: number;
  pickupFee?: number;
};

const EMS = [21, 24, 31, 43, 53, 63, 71, 93, 103, 113, 128, 143, 153, 168, 183, 193, 208, 223, 233, 248, 263, 273, 283, 293, 308, 323, 333, 348, 358, 373] as const;
const KEX: readonly ZonePrices[] = [
  [24, 24], [26, 26], [28, 28], [45, 49], [53, 57], [61, 67], [69, 76], [77, 85], [86, 94], [95, 103],
  [106, 114], [118, 125], [129, 136], [140, 148], [151, 159], [166, 174], [181, 189], [196, 204], [211, 219], [226, 234],
];
const FLASH: readonly DimensionTier[] = [
  [40, 24, 32], [50, 28, 36], [60, 32, 40], [70, 40, 44], [80, 49, 53], [85, 66, 66], [90, 75, 75], [95, 89, 89], [100, 98, 98], [105, 107, 107],
  [110, 125, 125], [115, 134, 134], [120, 143, 143], [125, 152, 152], [130, 161, 161], [135, 174, 174], [140, 183, 183], [145, 192, 192], [150, 201, 201], [155, 210, 210],
  [160, 228, 228], [165, 237, 237], [170, 246, 246], [175, 255, 255], [180, 264, 264], [185, 273, 273], [190, 282, 282], [195, 291, 291], [200, 300, 300], [205, 309, 309],
];
const SPX: readonly DimensionTier[] = [
  [80, 17, 22], [85, 21, 25], [90, 25, 28], [95, 34, 39], [100, 36, 43], [105, 45, 45], [110, 62, 62], [120, 73, 73], [125, 78, 78], [130, 90, 90],
  [135, 101, 101], [140, 116, 116], [145, 123, 123], [150, 132, 132], [155, 140, 140], [160, 152, 152], [165, 159, 159], [170, 167, 167], [175, 175, 175], [180, 183, 183],
];
const DHL_PREMIUM: readonly DimensionTier[] = [
  [60, 26, 31], [70, 30, 36], [70, 36, 43], [80, 46, 54], [90, 57, 64], [90, 70, 78], [100, 82, 88], [100, 95, 99], [110, 106, 116], [110, 116, 130],
  [110, 136, 159], [120, 146, 172], [120, 155, 187], [125, 164, 200], [130, 174, 210], [135, 190, 224], [140, 200, 238], [145, 209, 253], [150, 218, 270], [155, 228, 285],
  [160, 251, 304], [165, 284, 323], [170, 307, 341], [175, 326, 355], [180, 345, 370], [185, 369, 388], [190, 388, 402], [195, 406, 417], [200, 432, 438], [205, 461, 472],
];
const DHL_ECO: readonly DimensionTier[] = [
  [60, 21, 28], [70, 28, 33], [70, 32, 39], [80, 42, 50], [90, 54, 59], [90, 63, 70], [100, 74, 81], [100, 88, 92], [110, 98, 110], [110, 110, 124],
  [110, 128, 148], [120, 137, 161], [120, 147, 176], [125, 156, 189], [130, 165, 199], [135, 180, 213], [140, 189, 227], [145, 199, 242], [150, 208, 260], [155, 218, 274],
  [160, 242, 289], [165, 274, 307], [170, 298, 326], [175, 317, 340], [180, 336, 354], [185, 354, 373], [190, 373, 387], [195, 392, 401], [200, 418, 420], [205, 448, 458],
];

const kg = (parcel: ShippingParcel) => parcel.box_weight / 1000;
const dimensionSum = (parcel: ShippingParcel) => parcel.box_width + parcel.box_length + parcel.box_height;
const allSidesAtMost = (parcel: ShippingParcel, limit: number) =>
  parcel.box_width <= limit && parcel.box_length <= limit && parcel.box_height <= limit;
const money = (minor: number) => (minor / 100).toFixed(2);
const metroProvince = (value: string) => {
  const province = value.trim().replace(/^จังหวัด/u, "").replace(/\s+/gu, "");
  return ["กรุงเทพมหานคร", "กรุงเทพ", "ปทุมธานี", "นนทบุรี", "สมุทรปราการ"].includes(province);
};
const weightTier = (prices: readonly number[], parcel: ShippingParcel, maxSum: number, maxSide: number) => {
  if (!allSidesAtMost(parcel, maxSide) || dimensionSum(parcel) > maxSum) return null;
  const tier = Math.ceil(kg(parcel));
  return tier >= 1 && tier <= prices.length ? prices[tier - 1] : null;
};
const kexPrice = (parcel: ShippingParcel, metro: boolean) => {
  if (!allSidesAtMost(parcel, 100) || dimensionSum(parcel) > 180 || kg(parcel) > 20) return null;
  const billable = Math.max(kg(parcel), parcel.box_width * parcel.box_length * parcel.box_height / 6000);
  const tier = Math.ceil(billable);
  return tier >= 1 && tier <= KEX.length ? KEX[tier - 1][metro ? 0 : 1] : null;
};
const dimensionTierPrice = (prices: readonly DimensionTier[], parcel: ShippingParcel, metro: boolean, maxSide: number, maxSum: number) => {
  if (!allSidesAtMost(parcel, maxSide) || dimensionSum(parcel) > maxSum) return null;
  const tier = prices.findIndex((row, index) => kg(parcel) <= index + 1 && dimensionSum(parcel) <= row[0]);
  return tier < 0 ? null : prices[tier][metro ? 1 : 2];
};

const SERVICES: Record<string, PdfService> = {
  EMS_SPEED: { specialAreaFee: 20, parcelPrice: (p) => weightTier(EMS, p, 120, 60), codRate: 0.0275, codVat: 1.07 },
  KEX_SPEED: { specialAreaFee: 50, parcelPrice: kexPrice, pickupFee: 15 },
  FLASH_EXPRESS_SPEED: { specialAreaFee: 50, parcelPrice: (p, metro) => dimensionTierPrice(FLASH, p, metro, 150, 280), codRate: 0.0225 },
  SPX_SPEED: { specialAreaFee: 50, parcelPrice: (p, metro) => dimensionTierPrice(SPX, p, metro, 100, 180) },
  DHL_SPEED: { specialAreaFee: 50, parcelPrice: (p, metro) => dimensionTierPrice(DHL_PREMIUM, p, metro, 170, 250) },
  DHLECO_SPEED: { specialAreaFee: 50, parcelPrice: (p, metro) => dimensionTierPrice(DHL_ECO, p, metro, 170, 250) },
};

const unavailable = (reason: ShippingCostReference["reason"]): ShippingCostReference => ({
  source: "pdf_2026_04", available: false, base: null, extras: [],
  total: null, total_with_conditional: null, reason,
});

export function calculateShippingCostReference(carrierCode: string, draft: ShippingDraft): ShippingCostReference {
  const normalizedCode = carrierCode.trim().toUpperCase();
  const service = SERVICES[normalizedCode];
  if (!service) return unavailable("not_in_pdf");
  const parcels = shippingParcels(draft);
  const destinationMetro = metroProvince(draft.destination.state);
  const originMetro = metroProvince(draft.origin.state);
  const metro = normalizedCode === "FLASH_EXPRESS_SPEED" ? originMetro && destinationMetro : destinationMetro;
  const parcelPrices = parcels.map((parcel) => service.parcelPrice(parcel, metro));
  if (!parcelPrices.every((value): value is number => value !== null)) return unavailable("outside_pdf_conditions");

  const baseMinor = parcelPrices.reduce((sum, value) => sum + value * 100, 0);
  const extras: ShippingCostReference["extras"] = [];
  let totalMinor = baseMinor;
  const codMinor = moneyMinor(draft.cod_amount);
  if (codMinor > 0 && service.codRate) {
    const codFee = Math.round(codMinor * service.codRate * (service.codVat ?? 1));
    extras.push({ kind: "cod", amount: money(codFee), conditional: false });
    totalMinor += codFee;
  }
  if (service.pickupFee && parcels.length < 3) {
    const pickupFee = service.pickupFee * parcels.length * 100;
    extras.push({ kind: "pickup", amount: money(pickupFee), conditional: false });
    totalMinor += pickupFee;
  }
  const specialAreaMinor = service.specialAreaFee * parcels.length * 100;
  extras.push({ kind: "special_area", amount: money(specialAreaMinor), conditional: true });
  return {
    source: "pdf_2026_04", available: true, base: money(baseMinor), extras,
    total: money(totalMinor), total_with_conditional: money(totalMinor + specialAreaMinor), reason: null,
  };
}
