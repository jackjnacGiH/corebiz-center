import { MapPin, Phone, Package, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n";
import { SHIPPING_CARRIER_OPTIONS, shippingCarrierBrand } from "@/lib/shipping-carriers";
import { shippingParcels, summarizeShippingItems, type Shipment, type ShippingAddress } from "../../../../supabase/functions/_shared/shipping-domain";
const addressLine = (address: ShippingAddress) => [address.address, address.county, address.city, address.state, address.postcode].filter(Boolean).join(" ");

export default function ShipmentListCard({ shipment: s, busy, onOpen }: { shipment: Shipment; busy: boolean; onOpen: () => void }) {
  const { t, language } = useLanguage();
  const c = t.shipping;
  const recipient = s.draft.destination;
  const company = recipient.company || s.recipient_company;
  const sender = s.draft.origin;
  const parcels = shippingParcels(s.draft);
  const items = summarizeShippingItems(s.draft.products);
  const carrier = SHIPPING_CARRIER_OPTIONS.find(([code]) => code === s.draft.carrier_code)?.[1] || shippingCarrierBrand(s.draft.carrier_code).name;
  return <article className="overflow-hidden rounded-xl border bg-card" aria-label={s.reference_no}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
      <div className="min-w-0">
        <p className="break-all text-sm font-semibold">{s.reference_no}</p>
        <p className="mt-1 text-xs text-muted-foreground">{s.order_code || c.manual} · {new Date(s.created_at).toLocaleString(language === "th" ? "th-TH" : "en-GB")}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{c.statuses[s.status]}</span>
        <Button variant="outline" disabled={busy} onClick={onOpen}>{c.open}</Button>
      </div>
    </div>
    <div className="grid gap-5 p-4 md:grid-cols-2 xl:grid-cols-[1.25fr_1fr_0.85fr]">
      <section className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{c.destination}</p>
        <h2 className="break-words font-semibold">{company || recipient.fullname || "—"}</h2>
        {!!company && company !== recipient.fullname && !!recipient.fullname && <p className="text-sm">{c.fullname}: {recipient.fullname}</p>}
        <p className="flex items-start gap-2 break-words text-sm"><MapPin size={15} className="mt-0.5 shrink-0 text-muted-foreground" /><span>{addressLine(recipient) || "—"}</span></p>
        <p className="flex items-center gap-2 text-sm"><Phone size={15} className="shrink-0 text-muted-foreground" />{recipient.telephone1 || "—"}</p>
        {!!recipient.email && <p className="break-all text-xs text-muted-foreground">{recipient.email}</p>}
      </section>
      <section className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{c.origin}</p>
        <p className="break-words text-sm font-medium">{[...new Set([sender.company, sender.fullname].filter(Boolean))].join(" / ") || "—"}</p>
        <p className="break-words text-sm text-muted-foreground">{addressLine(sender) || "—"}</p>
        <p className="flex items-center gap-2 text-sm"><Phone size={15} className="shrink-0 text-muted-foreground" />{sender.telephone1 || "—"}</p>
      </section>
      <section className="min-w-0 space-y-2 border-t pt-3 text-sm xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
        <p className="flex items-center gap-2 font-semibold"><Truck size={16} />{s.draft.carrier_code ? carrier : c.awaitingCarrier}</p>
        <p className="flex items-center gap-2"><Package size={16} />{parcels.length} {c.boxUnit} · {items.totalQuantity.toLocaleString()} {c.pieceUnit} ({s.draft.products.length} {c.itemRows})</p>
        <p>{c.packedWeight}: {parcels.reduce((sum, p) => sum + p.box_weight, 0).toLocaleString()} {c.gramUnit}</p>
        <p className="break-all">{c.tracking}: {s.tracking_number || "—"}</p>
        <p>{Number(s.draft.cod_amount) > 0 ? `${c.cod}: ${Number(s.draft.cod_amount).toLocaleString()} ${c.baht}` : c.noCod}</p>
      </section>
    </div>
  </article>;
}
