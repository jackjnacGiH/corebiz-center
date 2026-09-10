import {
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Phone,
  Printer,
  RefreshCw,
  Trash2,
  Truck,
} from "lucide-react";
import type { SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n";
import {
  SHIPPING_CARRIER_OPTIONS,
  shippingCarrierBrand,
  shippingTrackingUrl,
} from "@/lib/shipping-carriers";
import { shippingParcels, summarizeShippingItems, type Shipment, type ShippingAddress } from "../../../../supabase/functions/_shared/shipping-domain";
const addressLine = (address: ShippingAddress) => [address.address, address.county, address.city, address.state, address.postcode].filter(Boolean).join(" ");

export type ShipmentListAction = "copy_tracking" | "carrier_label" | "refresh_status";

interface ShipmentListCardProps {
  shipment: Shipment;
  busy: boolean;
  readReady: boolean;
  activeAction: ShipmentListAction | null;
  onOpen: () => void;
  onDelete: () => void;
  onCopyTracking: (url: string) => void;
  onCarrierLabel: () => void;
  onRefreshStatus: () => void;
}

export default function ShipmentListCard({
  shipment: s,
  busy,
  readReady,
  activeAction,
  onOpen,
  onDelete,
  onCopyTracking,
  onCarrierLabel,
  onRefreshStatus,
}: ShipmentListCardProps) {
  const { t, language } = useLanguage();
  const c = t.shipping;
  const recipient = s.draft.destination;
  const company = recipient.company || s.recipient_company;
  const sender = s.draft.origin;
  const parcels = shippingParcels(s.draft);
  const items = summarizeShippingItems(s.draft.products);
  const carrier = SHIPPING_CARRIER_OPTIONS.find(([code]) => code === s.draft.carrier_code)?.[1] || shippingCarrierBrand(s.draft.carrier_code).name;
  const editableDraft = s.status === "draft" && !s.tracking_number;
  const trackingUrl = s.tracking_number && s.draft.carrier_code
    ? shippingTrackingUrl(s.draft.carrier_code, s.tracking_number)
    : null;
  const hasTracking = !!s.tracking_number;
  const providerActionsReady = readReady && !!s.draft.carrier_code;
  const idPrefix = `shipment-${s.id}`;
  const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();
  return <article className="overflow-hidden rounded-xl border border-t-4 border-slate-300 border-t-[#1696F4] bg-slate-100/70 shadow-sm shadow-slate-200/70" aria-labelledby={`${idPrefix}-reference`}>
    <header data-shipment-block="header" className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-900 bg-[#0C3C63] px-4 py-3 text-white">
      <div className="min-w-0">
        <h2 id={`${idPrefix}-reference`} className="break-all text-sm font-semibold">{s.reference_no}</h2>
        <p className="mt-1 text-xs text-sky-100">{s.order_code || c.manual} · {new Date(s.created_at).toLocaleString(language === "th" ? "th-TH" : "en-GB")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1 text-xs font-medium text-white">{c.statuses[s.status]}</span>
        <Button variant="outline" className="bg-white text-slate-900 hover:bg-sky-50 hover:text-slate-950" disabled={busy} onClick={onOpen}>{editableDraft && <Pencil size={15} />}{editableDraft ? t.common.edit : c.open}</Button>
        {editableDraft && <Button variant="outline" className="bg-white text-destructive hover:bg-red-50 hover:text-destructive" disabled={busy} onClick={onDelete}>
          <Trash2 size={15} />{c.deleteDraft}
        </Button>}
      </div>
    </header>
    <div className="grid gap-3 bg-slate-100/80 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-[1.25fr_1fr_0.85fr]">
      <section data-shipment-block="recipient" aria-labelledby={`${idPrefix}-recipient`} className="min-w-0 space-y-2 rounded-lg border border-blue-200 bg-blue-50/80 p-4 shadow-sm">
        <h3 id={`${idPrefix}-recipient`} className="inline-flex rounded-md bg-blue-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-sm">{c.destination}</h3>
        <p className="break-words text-base font-semibold">{company || recipient.fullname || "—"}</p>
        {!!company && company !== recipient.fullname && !!recipient.fullname && <p className="text-sm">{c.fullname}: {recipient.fullname}</p>}
        <p className="flex items-start gap-2 break-words text-sm"><MapPin size={15} className="mt-0.5 shrink-0 text-blue-700" /><span>{addressLine(recipient) || "—"}</span></p>
        <p className="flex items-center gap-2 text-sm"><Phone size={15} className="shrink-0 text-blue-700" />{recipient.telephone1 || "—"}</p>
        {!!recipient.email && <p className="break-all text-xs text-muted-foreground">{recipient.email}</p>}
      </section>
      <section data-shipment-block="sender" aria-labelledby={`${idPrefix}-sender`} className="min-w-0 space-y-2 rounded-lg border border-teal-200 bg-teal-50/80 p-4 shadow-sm">
        <h3 id={`${idPrefix}-sender`} className="inline-flex rounded-md bg-teal-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-sm">{c.origin}</h3>
        <p className="break-words text-sm font-medium">{[...new Set([sender.company, sender.fullname].filter(Boolean))].join(" / ") || "—"}</p>
        <p className="break-words text-sm text-slate-600">{addressLine(sender) || "—"}</p>
        <p className="flex items-center gap-2 text-sm"><Phone size={15} className="shrink-0 text-teal-700" />{sender.telephone1 || "—"}</p>
      </section>
      <section data-shipment-block="parcel" aria-labelledby={`${idPrefix}-parcel`} className="min-w-0 space-y-2 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm shadow-sm md:col-span-2 xl:col-span-1">
        <h3 id={`${idPrefix}-parcel`} className="inline-flex rounded-md bg-amber-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-sm">{c.parcel}</h3>
        <p className="flex items-center gap-2 font-semibold"><Truck size={16} className="shrink-0 text-amber-700" />{s.draft.carrier_code ? carrier : c.awaitingCarrier}</p>
        <p className="flex items-center gap-2"><Package size={16} className="shrink-0 text-amber-700" />{parcels.length} {c.boxUnit} · {items.totalQuantity.toLocaleString()} {c.pieceUnit} ({s.draft.products.length} {c.itemRows})</p>
        <p>{c.packedWeight}: {parcels.reduce((sum, p) => sum + p.box_weight, 0).toLocaleString()} {c.gramUnit}</p>
        <p className="break-all">{c.tracking}: {s.tracking_number || "—"}</p>
        <p>{Number(s.draft.cod_amount) > 0 ? `${c.cod}: ${Number(s.draft.cod_amount).toLocaleString()} ${c.baht}` : c.noCod}</p>
      </section>
    </div>
    {hasTracking && <footer data-shipment-block="actions" aria-labelledby={`${idPrefix}-actions`} className="border-t border-slate-300 bg-slate-200/80 px-3 py-3 sm:px-4 sm:py-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <h3 id={`${idPrefix}-actions`} className="inline-flex self-start rounded-md bg-slate-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-white shadow-sm">{c.actions}</h3>
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 sm:flex sm:flex-wrap sm:justify-end" aria-busy={activeAction !== null}>
          {trackingUrl && <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              aria-label={c.copyTrackingLink}
              onClick={(event) => {
                stopPropagation(event);
                onCopyTracking(trackingUrl);
              }}
            >
              {activeAction === "copy_tracking" ? <Loader2 className="animate-spin" /> : <Copy />}
              {c.copyTrackingLink}
            </Button>
            <Button asChild size="sm" variant="outline">
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={c.openTracking}
                onClick={stopPropagation}
              >
                <ExternalLink />{c.openTracking}
              </a>
            </Button>
          </>}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !providerActionsReady}
            title={!providerActionsReady ? c.actionsRequireConnection : undefined}
            aria-label={c.carrierPrint}
            onClick={(event) => {
              stopPropagation(event);
              onCarrierLabel();
            }}
          >
            {activeAction === "carrier_label" ? <Loader2 className="animate-spin" /> : <Printer />}
            {c.carrierPrint}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !providerActionsReady}
            title={!providerActionsReady ? c.actionsRequireConnection : undefined}
            aria-label={c.poll}
            onClick={(event) => {
              stopPropagation(event);
              onRefreshStatus();
            }}
          >
            {activeAction === "refresh_status" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {c.poll}
          </Button>
        </div>
      </div>
    </footer>}
  </article>;
}
