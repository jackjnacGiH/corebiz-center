import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import type { Shipment, ShippingAddress } from "@/lib/shipping-api";
import { shippingCarrierBrand } from "@/lib/shipping-carriers";

export const SHIPPING_LABEL_ID = "shipping-label-document";

function addressLine(a: ShippingAddress) {
  return [a.address, a.county, a.city, a.state, a.postcode]
    .filter(Boolean)
    .join(" ");
}

function ContactBlock({
  title,
  address,
  receiver = false,
}: {
  title: string;
  address: ShippingAddress;
  receiver?: boolean;
}) {
  return (
    <section
      className={`border-b-2 border-black px-[4mm] py-[2.5mm] ${receiver ? "min-h-[31mm]" : "min-h-[24mm]"}`}
    >
      <p className="text-[9px] font-bold uppercase tracking-[0.12em]">
        {title}
      </p>
      <p
        className={`${receiver ? "text-[16px]" : "text-[13px]"} line-clamp-2 break-words font-black leading-tight mt-1`}
      >
        {address.fullname || "—"}
      </p>
      <p
        className={`${receiver ? "text-[12px]" : "text-[10px]"} line-clamp-3 break-words font-semibold leading-snug mt-1`}
      >
        {addressLine(address) || "—"}
      </p>
      <p
        className={`${receiver ? "text-[13px]" : "text-[11px]"} font-black mt-1`}
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
          className="h-[10mm] max-w-[38mm] object-contain"
          onError={() => setFailed(true)}
        />
        <p className="mt-1 text-[7px] font-bold uppercase tracking-wider">
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
  logoUrl,
}: {
  companyName: string;
  logoUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [logoUrl]);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={companyName}
        className="h-[14mm] max-w-[25mm] object-contain"
        crossOrigin="anonymous"
        onError={() => setFailed(true)}
      />
    );
  }
  return <div className="text-[21px] font-black tracking-tight">J NAC</div>;
}

export default function ShippingLabel({
  shipment,
  companyName,
  companyLogoUrl,
}: {
  shipment: Shipment;
  companyName?: string | null;
  companyLogoUrl?: string | null;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const carrier = shippingCarrierBrand(shipment.draft.carrier_code);
  const barcodeValue = shipment.tracking_number || shipment.reference_no;
  const quantity = shipment.draft.products.reduce(
    (sum, item) => sum + item.qty,
    0,
  );
  const cod = Number(shipment.draft.cod_amount || 0);
  const handlingNote =
    shipment.draft.handling_note || "กรุณาอย่าโยน • ระวังของแตก";
  const handlingSize =
    handlingNote.length > 60
      ? "text-[10px]"
      : handlingNote.length > 36
        ? "text-[13px]"
        : "text-[17px]";

  useEffect(() => {
    if (!barcodeRef.current || !barcodeValue) return;
    try {
      JsBarcode(barcodeRef.current, barcodeValue, {
        format: "CODE128",
        displayValue: false,
        height: 46,
        width: 1.55,
        margin: 0,
      });
    } catch {
      barcodeRef.current.replaceChildren();
    }
  }, [barcodeValue]);

  return (
    <article
      id={SHIPPING_LABEL_ID}
      aria-label="ตัวอย่างใบปะหน้าขนส่ง"
      className="shipping-label-document box-border flex h-[150mm] w-[100mm] flex-col overflow-hidden border-2 border-black bg-white font-sans text-black"
    >
      <header className="grid h-[22mm] grid-cols-[1fr_1fr] border-b-2 border-black">
        <div className="flex min-w-0 items-center gap-2 border-r-2 border-black px-[3mm] py-[2mm]">
          <CompanyLogo
            companyName={companyName || "J NAC (THAILAND) CO., LTD."}
            logoUrl={companyLogoUrl}
          />
          <div className="min-w-0">
            <p className="text-[8px] font-black uppercase tracking-wider">
              ผู้ส่งสินค้า
            </p>
            <p className="line-clamp-2 text-[7px] leading-tight">
              {companyName || "J NAC (THAILAND) CO., LTD."}
            </p>
          </div>
        </div>
        <div className="relative flex min-w-0 items-center justify-center overflow-hidden px-[2mm] text-center">
          <span
            className="absolute inset-y-0 left-0 w-[2.3mm]"
            style={{ background: carrier.accent }}
          />
          <CarrierLogo carrier={carrier} />
        </div>
      </header>

      <section className="border-b-2 border-black px-[4mm] py-[2.5mm] text-center">
        <p className="text-[8px] font-bold uppercase tracking-[0.15em]">
          Tracking Number
        </p>
        <p className="my-1 break-all text-[20px] font-black leading-none tracking-[0.04em]">
          {shipment.tracking_number || "ยังไม่มีเลข TRACKING"}
        </p>
        <svg
          ref={barcodeRef}
          aria-label={`Barcode ${barcodeValue}`}
          className="mx-auto h-[12mm] max-w-full"
        />
        <p className="mt-1 text-[7px] font-semibold">{barcodeValue}</p>
      </section>

      <ContactBlock
        title="ผู้รับ (TO)"
        address={shipment.draft.destination}
        receiver
      />
      <ContactBlock title="ผู้ส่ง (FROM)" address={shipment.draft.origin} />

      <section className="grid min-h-[15mm] grid-cols-[1.3fr_.7fr] border-b-2 border-black">
        <div className="flex flex-col justify-center border-r-2 border-black px-[4mm] py-[2mm]">
          <p className="text-[8px] font-bold uppercase">
            เก็บเงินปลายทาง (COD)
          </p>
          <p className="text-[18px] font-black leading-tight">
            {cod > 0
              ? `${cod.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท`
              : "ไม่เก็บเงินปลายทาง"}
          </p>
        </div>
        <div className="flex flex-col justify-center px-[3mm] py-[2mm] text-center">
          <p className="text-[8px] font-bold">จำนวนสินค้า</p>
          <p className="text-[19px] font-black">
            {quantity.toLocaleString("th-TH")}
          </p>
        </div>
      </section>

      <section className="min-h-0 flex-1 px-[4mm] py-[2.5mm]">
        <div className="flex items-start justify-between gap-2 text-[8px]">
          <p>
            <strong>อ้างอิง:</strong>{" "}
            {shipment.order_code || shipment.reference_no}
          </p>
          <p className="shrink-0">
            <strong>กล่อง:</strong> 1/1
          </p>
        </div>
        <p className="mt-1 text-[8px]">
          <strong>บริการ:</strong> {carrier.name} ·{" "}
          {shipment.draft.carrier_code || "—"}
        </p>
        <p className="mt-1 line-clamp-2 text-[8px]">
          <strong>สินค้า:</strong>{" "}
          {shipment.draft.products
            .map((item) => `${item.name || "—"} ×${item.qty}`)
            .join(", ")}
        </p>
      </section>

      <footer className="flex min-h-[14mm] items-center justify-center border-t-[3px] border-black bg-black px-[3mm] py-[2mm] text-center text-white">
        <p
          className={`${handlingSize} line-clamp-3 break-words font-black leading-tight tracking-wide`}
        >
          {handlingNote}
        </p>
      </footer>
    </article>
  );
}
