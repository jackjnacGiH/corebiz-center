import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import type { Shipment, ShippingAddress } from "@/lib/shipping-api";
import { shippingCarrierBrand } from "@/lib/shipping-carriers";
import lineAddQrUrl from "@/assets/line-add-jnac.jpg";
import shippingCompanyLogoUrl from "@/assets/shipping/jnac-logo.png";
import { summarizeShippingItems } from "../../../../supabase/functions/_shared/shipping-domain";

export const SHIPPING_LABEL_ID = "shipping-label-batch";

function addressLine(a: ShippingAddress) {
  return [a.address, a.county, a.city, a.state, a.postcode]
    .filter(Boolean)
    .join(" ");
}

function ContactBlock({
  title,
  address,
  receiver = false,
  embedded = false,
}: {
  title: string;
  address: ShippingAddress;
  receiver?: boolean;
  embedded?: boolean;
}) {
  return (
    <section
      className={`${embedded ? "" : "border-b-2 border-black"} flex min-h-0 flex-col gap-[0.25mm] px-[3mm] py-[0.75mm]`}
    >
      <div className={receiver ? "" : "flex items-baseline gap-[2mm]"}>
        <p className="shrink-0 text-[8px] font-bold uppercase leading-[10px]">
          {title}
        </p>
        <p
          className={`${receiver ? "mt-[0.25mm] text-[14px] leading-[16px]" : "text-[12px] leading-[13px]"} min-w-0 line-clamp-2 break-words pb-px font-black`}
        >
          {[...new Set([address.company, address.fullname].filter(Boolean))].join(" / ") || "—"}
        </p>
      </div>
      <p
        className={`${receiver ? "text-[10px] leading-[12px]" : "text-[9px] leading-[10px]"} line-clamp-3 break-words pb-px font-semibold`}
      >
        {addressLine(address) || "—"}
      </p>
      <p
        className={`${receiver ? "text-[11px] leading-[13px]" : "text-[10px] leading-[11px]"} font-black`}
      >
        โทร {address.telephone1 || "—"}
      </p>
    </section>
  );
}

function CarrierLogo({
  carrier,
}: {
  carrier: ReturnType<typeof shippingCarrierBrand>;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [carrier.logoUrl]);

  if (carrier.logoUrl && !failed) {
    return (
      <div className="flex flex-col items-center">
        <img
          src={carrier.logoUrl}
          alt={carrier.name}
          className="h-[9mm] w-[32mm] max-w-full object-contain"
          onError={() => setFailed(true)}
        />
        <p className="mt-[0.5mm] text-[7px] font-bold uppercase leading-[8px] tracking-wider">
          {carrier.name}
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[21px] font-black italic leading-none tracking-tight">
        {carrier.shortName}
      </p>
      <p className="mt-1 text-[8px] font-bold uppercase tracking-wider">
        {carrier.name}
      </p>
    </div>
  );
}

function CompanyLogo({
  companyName,
}: {
  companyName: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!failed) {
    return (
      <img
        src={shippingCompanyLogoUrl}
        alt={companyName}
        className="h-[10mm] w-[40mm] max-w-full object-contain object-left"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="flex h-[10mm] items-center text-[20px] font-black text-[#1696f4]">
      J NAC
    </div>
  );
}

function ShippingLabelPage({
  shipment,
  companyName,
  parcelNumber,
  parcelTotal,
}: {
  shipment: Shipment;
  companyName?: string | null;
  parcelNumber: number;
  parcelTotal: number;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const carrier = shippingCarrierBrand(shipment.draft.carrier_code);
  const barcodeValue = shipment.tracking_number || shipment.reference_no;
  const itemSummary = summarizeShippingItems(shipment.draft.products);
  const quantity = itemSummary.totalQuantity;
  const cod = Number(shipment.draft.cod_amount || 0);
  const handlingNote =
    shipment.draft.handling_note || "กรุณาอย่าโยน • ระวังของแตก";
  const handlingSize =
    handlingNote.length > 60
      ? "text-[9px] leading-[12px]"
      : handlingNote.length > 36
        ? "text-[13px] leading-[18px]"
        : "text-[16px] leading-[20px]";

  useEffect(() => {
    if (!barcodeRef.current || !barcodeValue) return;
    try {
      JsBarcode(barcodeRef.current, barcodeValue, {
        format: "CODE128",
        displayValue: false,
        height: 92,
        width: 1.55,
        margin: 0,
      });
    } catch {
      barcodeRef.current.replaceChildren();
    }
  }, [barcodeValue]);

  return (
    <article
      aria-label={`ตัวอย่างใบปะหน้าขนส่ง กล่อง ${parcelNumber}/${parcelTotal}`}
      className="shipping-label-document box-border grid h-[150mm] w-[100mm] grid-rows-[20mm_35mm_28mm_21mm_10mm_minmax(0,1fr)_12mm] overflow-hidden border-2 border-black bg-white font-sans text-black"
    >
      <header className="relative flex min-h-0 items-center gap-[2mm] border-b-2 border-black px-[3mm] pb-[1mm] pt-[2.5mm]">
        <span
          className="absolute inset-x-0 top-0 h-[1.8mm]"
          style={{
            background: `linear-gradient(90deg, #1696f4 0%, #1696f4 58%, ${carrier.accent} 58%, ${carrier.accent} 100%)`,
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-[0.5mm]">
          <CompanyLogo
            companyName={companyName || "J NAC (THAILAND) CO., LTD."}
          />
          <p className="line-clamp-2 pb-px text-[12px] font-black leading-[14px] text-neutral-800">
            {companyName || "J NAC (THAILAND) CO., LTD."}
          </p>
        </div>
        <div className="flex w-[32mm] shrink-0 items-center justify-center text-center">
          <div className="flex flex-col items-center">
            <p className="mb-[0.5mm] text-[7px] font-bold leading-[9px] text-neutral-600">
              ผู้ให้บริการขนส่ง
            </p>
            <CarrierLogo carrier={carrier} />
          </div>
        </div>
      </header>

      <section className="grid min-h-0 grid-rows-[2.4mm_5.3mm_24mm_2.4mm] content-center gap-y-[0.1mm] border-b-2 border-black px-[4mm] text-center">
        <p className="text-[8px] font-bold uppercase leading-[9px] tracking-[0.15em]">
          Tracking Number
        </p>
        <p className="truncate text-[17px] font-black leading-[20px] tracking-[0.04em]">
          {shipment.tracking_number || "ยังไม่มีเลข TRACKING"}
        </p>
        <svg
          ref={barcodeRef}
          aria-label={`Barcode ${barcodeValue}`}
          className="block h-[24mm] w-full"
        />
        <p className="text-[7px] font-semibold leading-[9px]">{barcodeValue}</p>
      </section>

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_26mm] border-b-2 border-black">
        <ContactBlock
          title="ผู้รับ (TO)"
          address={shipment.draft.destination}
          receiver
          embedded
        />
        <aside className="grid min-h-0 grid-rows-[8mm_minmax(0,1fr)] border-l-2 border-black">
          <div className="flex items-center justify-center bg-black text-white">
            <p className="text-[23px] font-black leading-none">
              {parcelNumber}/{parcelTotal}
            </p>
          </div>
          <div className="flex min-h-0 flex-col items-center justify-center">
            <img
              src={lineAddQrUrl}
              alt="QR เพิ่มเพื่อน LINE @jnac"
              className="h-[17mm] w-[17mm] object-contain"
            />
            <p className="text-[6px] font-black leading-none">LINE @jnac</p>
          </div>
        </aside>
      </section>
      <ContactBlock title="ผู้ส่ง (FROM)" address={shipment.draft.origin} />

      <section className="grid min-h-0 grid-cols-[1.3fr_.7fr] border-b-2 border-black">
        <div className="flex min-w-0 flex-col justify-center border-r-2 border-black px-[3mm] py-[0.5mm]">
          <p className="text-[8px] font-bold uppercase leading-[9px]">
            เก็บเงินปลายทาง (COD)
          </p>
          <p className="text-[16px] font-black leading-[18px]">
            {cod > 0
              ? `${cod.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`
              : "ไม่มีเก็บเงิน"}
          </p>
        </div>
        <div className="flex flex-col justify-center px-[3mm] py-[0.5mm] text-center">
          <p className="text-[8px] font-bold leading-[9px]">{parcelTotal > 1 ? "สินค้ารวมทั้งชุด" : "จำนวนสินค้ารวม"}</p>
          <p className="text-[16px] font-black leading-[18px]">
            {quantity.toLocaleString("th-TH")}
          </p>
        </div>
      </section>

      <section aria-label="อ้างอิงและสินค้า" className="min-h-0 px-[3mm] py-[1mm]">
        <p className="break-words text-[8px] leading-[11px]">
          <strong>อ้างอิง:</strong>{" "}
          {shipment.order_code || shipment.reference_no}
        </p>
        <p className="mt-[0.25mm] text-[8px] font-bold leading-[11px]">{parcelTotal > 1 ? "รายการสินค้ารวมทั้งชุด:" : "สินค้าในกล่อง:"}</p>
        <ul className={`mt-[0.25mm] font-semibold ${shipment.draft.products.length > 5 ? "text-[7px] leading-[9px]" : "text-[8px] leading-[11px]"}`}>
          {itemSummary.visible.map((item, index) => (
            <li key={index} className="flex min-w-0 justify-between gap-[2mm]">
              <span className="truncate">
                {item.code ? `${item.code} · ` : ""}
                {item.name || "—"}
              </span>
              <span className="shrink-0">×{item.qty}</span>
            </li>
          ))}
          {itemSummary.remainingItems > 0 && (
            <li className="flex justify-between gap-[1mm] border-t border-black pt-px font-black">
              <span>รายการอื่น ๆ ({itemSummary.remainingItems} รายการ)</span>
              <span className="shrink-0">รวม {itemSummary.remainingQuantity} ชิ้น</span>
            </li>
          )}
        </ul>
      </section>

      <footer className="flex min-h-0 items-center justify-center border-t-2 border-black bg-black px-[3mm] py-[0.75mm] text-center text-white">
        <p
          className={`${handlingSize} line-clamp-3 break-words font-black`}
        >
          {handlingNote}
        </p>
      </footer>
    </article>
  );
}

export default function ShippingLabel({
  shipment,
  companyName,
}: {
  shipment: Shipment;
  companyName?: string | null;
}) {
  const parcelTotal = Math.max(
    1,
    Math.min(99, Math.trunc(shipment.draft.parcel_total || 1)),
  );

  return (
    <div id={SHIPPING_LABEL_ID} className="shipping-label-batch">
      {Array.from({ length: parcelTotal }, (_, index) => (
        <div
          key={index}
          className="shipping-label-page mb-3 last:mb-0"
        >
          <ShippingLabelPage
            shipment={shipment}
            companyName={companyName}
            parcelNumber={index + 1}
            parcelTotal={parcelTotal}
          />
        </div>
      ))}
    </div>
  );
}
