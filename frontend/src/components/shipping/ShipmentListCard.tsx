import {
  ChevronDown,
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
import {
  shippingParcels,
  summarizeShippingItems,
  type Shipment,
  type ShippingAddress,
} from "../../../../supabase/functions/_shared/shipping-domain";

const addressLine = (address: ShippingAddress) =>
  [address.address, address.county, address.city, address.state, address.postcode]
    .filter(Boolean)
    .join(" ");

export type ShipmentListAction =
  | "copy_tracking"
  | "carrier_label"
  | "refresh_status";

interface ShipmentListCardProps {
  shipment: Shipment;
  expanded: boolean;
  busy: boolean;
  readReady: boolean;
  activeAction: ShipmentListAction | null;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onJnacLabel: () => void;
  onCopyTracking: (url: string) => void;
  onCarrierLabel: () => void;
  onRefreshStatus: () => void;
}

export default function ShipmentListCard({
  shipment: s,
  expanded,
  busy,
  readReady,
  activeAction,
  onToggle,
  onOpen,
  onDelete,
  onJnacLabel,
  onCopyTracking,
  onCarrierLabel,
  onRefreshStatus,
}: ShipmentListCardProps) {
  const { t, language } = useLanguage();
  const c = t.shipping;
  const recipient = s.draft.destination;
  const company = recipient.company || s.recipient_company;
  const recipientName = company || recipient.fullname || "—";
  const sender = s.draft.origin;
  const parcels = shippingParcels(s.draft);
  const items = summarizeShippingItems(s.draft.products);
  const packedWeight = parcels.reduce(
    (sum, parcel) => sum + parcel.box_weight,
    0,
  );
  const carrier =
    SHIPPING_CARRIER_OPTIONS.find(
      ([code]) => code === s.draft.carrier_code,
    )?.[1] || shippingCarrierBrand(s.draft.carrier_code).name;
  const editableDraft = s.status === "draft" && !s.tracking_number;
  const trackingUrl =
    s.tracking_number && s.draft.carrier_code
      ? shippingTrackingUrl(s.draft.carrier_code, s.tracking_number)
      : null;
  const hasTracking = !!s.tracking_number;
  const providerActionsReady = readReady && !!s.draft.carrier_code;
  const idPrefix = `shipment-${s.id}`;
  const detailsId = `${idPrefix}-details`;
  const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();
  const hasOrderShippingFee =
    typeof s.order_shipping_fee === "number" &&
    Number.isFinite(s.order_shipping_fee) &&
    s.order_shipping_fee > 0;
  const orderShippingFee = hasOrderShippingFee
    ? new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(s.order_shipping_fee as number)
    : null;

  return (
    <article
      className={`overflow-hidden rounded-xl border border-l-4 bg-white shadow-sm transition-shadow ${
        expanded
          ? "border-sky-300 border-l-[var(--brand-blue)] shadow-slate-300/70"
          : "border-slate-200 border-l-slate-400 hover:shadow-md"
      }`}
      aria-labelledby={`${idPrefix}-recipient-name`}
    >
      <button
        type="button"
        data-shipment-block="summary"
        className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3 text-left transition-colors hover:bg-sky-50/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:grid-cols-[minmax(0,1fr)_minmax(150px,.55fr)] xl:grid-cols-[minmax(240px,1.35fr)_minmax(190px,1fr)_minmax(175px,.8fr)_minmax(155px,.7fr)_auto]"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className="sr-only">
          {expanded ? c.hideShipmentDetails : c.showShipmentDetails}
        </span>
        <span className="col-start-1 row-start-1 min-w-0 xl:col-auto xl:row-auto">
          <span className="block text-xs font-semibold uppercase tracking-wide text-blue-700">
            {c.destination}
          </span>
          <span
            id={`${idPrefix}-recipient-name`}
            className="mt-0.5 block break-words text-base font-semibold text-slate-950"
          >
            {recipientName}
          </span>
          {!!company &&
            company !== recipient.fullname &&
            !!recipient.fullname && (
              <span className="mt-0.5 block break-words text-xs text-slate-600">
                {c.fullname}: {recipient.fullname}
              </span>
            )}
          <span className="mt-1 block break-all text-xs text-slate-500">
            {s.order_code || c.manual} · {s.reference_no}
          </span>
        </span>

        <span className="col-span-2 row-start-2 min-w-0 xl:col-span-1 xl:row-auto">
          <span className="block text-xs font-semibold text-slate-500">
            {c.selectedCarrier}
          </span>
          <span className="mt-0.5 flex items-center gap-2 break-words text-sm font-semibold text-slate-900">
            <Truck
              size={16}
              className="shrink-0 text-orange-600"
              aria-hidden="true"
            />
            {s.draft.carrier_code ? carrier : c.awaitingCarrier}
          </span>
          <span className="mt-1 block break-all text-xs text-slate-500">
            {c.tracking}: {s.tracking_number || "—"}
          </span>
        </span>

        <span className="col-start-1 row-start-3 min-w-0 xl:col-auto xl:row-auto">
          <span className="block text-xs font-semibold text-slate-500">
            {c.parcel}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-sm font-medium text-slate-900">
            <Package
              size={16}
              className="shrink-0 text-amber-700"
              aria-hidden="true"
            />
            {parcels.length} {c.boxUnit} · {items.totalQuantity.toLocaleString()} {c.pieceUnit}
          </span>
          <span className="mt-1 block text-xs text-slate-500">
            {c.packedWeight}: {packedWeight.toLocaleString()} {c.gramUnit}
          </span>
        </span>

        <span className="col-start-2 row-start-3 min-w-0 max-w-44 xl:col-auto xl:row-auto xl:max-w-none">
          <span className="block text-xs font-semibold text-slate-500">
            {c.orderShippingFee}
          </span>
          <span
            className={`mt-0.5 block text-sm font-semibold tabular-nums ${
              orderShippingFee ? "text-emerald-700" : "text-slate-500"
            }`}
          >
            {orderShippingFee
              ? `${orderShippingFee} ${c.baht}`
              : c.shippingFeeUnavailable}
          </span>
          <span className="mt-1 hidden text-xs text-slate-500 xl:block">
            {new Date(s.created_at).toLocaleString(
              language === "th" ? "th-TH" : "en-GB",
            )}
          </span>
        </span>

        <span className="col-start-2 row-start-1 flex items-center justify-end gap-3 justify-self-end xl:col-auto xl:row-auto">
          <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-800">
            {c.statuses[s.status]}
          </span>
          <ChevronDown
            size={20}
            aria-hidden="true"
            className={`shrink-0 text-slate-500 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      {expanded && (
        <div
          id={detailsId}
          role="region"
          aria-labelledby={`${idPrefix}-recipient-name`}
          data-shipment-block="details"
        >
          <div className="grid gap-3 border-t border-slate-200 bg-slate-100/80 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-[1.25fr_1fr_0.85fr]">
            <section
              data-shipment-block="recipient"
              aria-labelledby={`${idPrefix}-recipient`}
              className="min-w-0 space-y-2 rounded-lg border border-blue-200 bg-blue-50/80 p-4 shadow-sm"
            >
              <h3
                id={`${idPrefix}-recipient`}
                className="shipment-list-card-heading inline-flex rounded-md bg-blue-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide shadow-sm"
              >
                {c.destination}
              </h3>
              <p className="break-words text-base font-semibold">
                {recipientName}
              </p>
              {!!company &&
                company !== recipient.fullname &&
                !!recipient.fullname && (
                  <p className="text-sm">
                    {c.fullname}: {recipient.fullname}
                  </p>
                )}
              <p className="flex items-start gap-2 break-words text-sm">
                <MapPin
                  size={15}
                  className="mt-0.5 shrink-0 text-blue-700"
                  aria-hidden="true"
                />
                <span>{addressLine(recipient) || "—"}</span>
              </p>
              <p className="flex items-center gap-2 text-sm">
                <Phone
                  size={15}
                  className="shrink-0 text-blue-700"
                  aria-hidden="true"
                />
                {recipient.telephone1 || "—"}
              </p>
              {!!recipient.email && (
                <p className="break-all text-xs text-muted-foreground">
                  {recipient.email}
                </p>
              )}
            </section>

            <section
              data-shipment-block="sender"
              aria-labelledby={`${idPrefix}-sender`}
              className="min-w-0 space-y-2 rounded-lg border border-teal-200 bg-teal-50/80 p-4 shadow-sm"
            >
              <h3
                id={`${idPrefix}-sender`}
                className="shipment-list-card-heading inline-flex rounded-md bg-teal-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide shadow-sm"
              >
                {c.origin}
              </h3>
              <p className="break-words text-sm font-medium">
                {[...new Set([sender.company, sender.fullname].filter(Boolean))]
                  .join(" / ") || "—"}
              </p>
              <p className="break-words text-sm text-slate-600">
                {addressLine(sender) || "—"}
              </p>
              <p className="flex items-center gap-2 text-sm">
                <Phone
                  size={15}
                  className="shrink-0 text-teal-700"
                  aria-hidden="true"
                />
                {sender.telephone1 || "—"}
              </p>
            </section>

            <section
              data-shipment-block="parcel"
              aria-labelledby={`${idPrefix}-parcel`}
              className="min-w-0 space-y-2 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm shadow-sm md:col-span-2 xl:col-span-1"
            >
              <h3
                id={`${idPrefix}-parcel`}
                className="shipment-list-card-heading inline-flex rounded-md bg-amber-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide shadow-sm"
              >
                {c.parcel}
              </h3>
              <p className="flex items-center gap-2 font-semibold">
                <Truck
                  size={16}
                  className="shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                {s.draft.carrier_code ? carrier : c.awaitingCarrier}
              </p>
              <p className="flex items-center gap-2">
                <Package
                  size={16}
                  className="shrink-0 text-amber-700"
                  aria-hidden="true"
                />
                {parcels.length} {c.boxUnit} · {items.totalQuantity.toLocaleString()} {c.pieceUnit} ({s.draft.products.length} {c.itemRows})
              </p>
              <p>
                {c.packedWeight}: {packedWeight.toLocaleString()} {c.gramUnit}
              </p>
              <p className="break-all">
                {c.tracking}: {s.tracking_number || "—"}
              </p>
              <p>
                {Number(s.draft.cod_amount) > 0
                  ? `${c.cod}: ${Number(s.draft.cod_amount).toLocaleString()} ${c.baht}`
                  : c.noCod}
              </p>
              <p>
                {c.orderShippingFee}: {orderShippingFee
                  ? `${orderShippingFee} ${c.baht}`
                  : c.shippingFeeUnavailable}
              </p>
            </section>
          </div>

          <footer
            data-shipment-block="actions"
            aria-labelledby={`${idPrefix}-actions`}
            className="border-t border-slate-300 bg-slate-200/80 px-3 py-3 sm:px-4 sm:py-4"
          >
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <h3
                id={`${idPrefix}-actions`}
                className="shipment-list-card-heading inline-flex self-start rounded-md bg-slate-700 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide shadow-sm"
              >
                {c.actions}
              </h3>
              <div
                className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 sm:flex sm:flex-wrap sm:justify-end"
                aria-busy={activeAction !== null}
              >
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={onOpen}
                >
                  {editableDraft && <Pencil size={15} />}
                  {editableDraft ? t.common.edit : c.open}
                </Button>
                {editableDraft && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:bg-red-50 hover:text-destructive"
                    disabled={busy}
                    onClick={onDelete}
                  >
                    <Trash2 size={15} />
                    {c.deleteDraft}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-blue-300 bg-blue-50 text-blue-950 hover:bg-blue-100 hover:text-blue-950"
                  disabled={busy}
                  aria-label={`${c.jnacPrint} ${s.reference_no}`}
                  onClick={(event) => {
                    stopPropagation(event);
                    onJnacLabel();
                  }}
                >
                  <Printer />
                  {c.jnacPrint}
                </Button>
                {hasTracking && (
                  <>
                    {trackingUrl && (
                      <>
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
                          {activeAction === "copy_tracking" ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Copy />
                          )}
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
                            <ExternalLink />
                            {c.openTracking}
                          </a>
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !providerActionsReady}
                      title={
                        !providerActionsReady
                          ? c.actionsRequireConnection
                          : undefined
                      }
                      aria-label={c.carrierPrint}
                      onClick={(event) => {
                        stopPropagation(event);
                        onCarrierLabel();
                      }}
                    >
                      {activeAction === "carrier_label" ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Printer />
                      )}
                      {c.carrierPrint}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !providerActionsReady}
                      title={
                        !providerActionsReady
                          ? c.actionsRequireConnection
                          : undefined
                      }
                      aria-label={c.poll}
                      onClick={(event) => {
                        stopPropagation(event);
                        onRefreshStatus();
                      }}
                    >
                      {activeAction === "refresh_status" ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <RefreshCw />
                      )}
                      {c.poll}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </footer>
        </div>
      )}
    </article>
  );
}
