import { useState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n";
import { SHIPPING_CARRIER_OPTIONS, shippingCarrierBrand } from "@/lib/shipping-carriers";
import type { ShippingRate } from "../../../../supabase/functions/_shared/shipping-rates";

function RateLogo({ rate }: { rate: ShippingRate }) {
  const brand = shippingCarrierBrand(rate.carrier_code);
  const [failed, setFailed] = useState(false);
  const url = brand.logoUrl || rate.logo;
  return url && !failed ? <img src={url} alt={rate.carrier} className="h-7 w-12 object-contain" onError={() => setFailed(true)} />
    : <span className="break-words text-xs font-black" style={{ color: brand.accent }}>{brand.shortName}</span>;
}

export default function ShippingRateComparison({ rates, selected, parcelCount, blockers, readReady, busy, environment, onCompare, onSelect }: {
  rates: ShippingRate[];
  selected: string;
  parcelCount: number;
  blockers: string[];
  readReady: boolean;
  busy: boolean;
  environment: "uat" | "production";
  onCompare: () => void;
  onSelect: (code: string) => void;
}) {
  const { t, language } = useLanguage();
  const c = t.shipping;
  const price = (value: string) => new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(value));
  return (
    <section className="rounded-xl border p-3 space-y-3 sm:p-4" aria-label={c.compareRates}>
      <div className="section-heading flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-semibold">2. {c.compareAndChoose}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{c.compareHint}</p>
        </div>
        <Button type="button" disabled={busy || !readReady || !!blockers.length} onClick={onCompare} aria-describedby="shipping-quote-status">
          <RefreshCw size={16} className={busy ? "animate-spin" : ""} />{c.compareRates}
        </Button>
      </div>
      <div id="shipping-quote-status" className="text-sm empty:hidden" aria-live="polite">
        {blockers.length > 0 ? <>
          <p className="font-medium">{c.quoteMissing}</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">{blockers.map((message) => <li key={message}>{message}</li>)}</ul>
        </> : !rates.length && <p className="text-muted-foreground">{readReady ? c.quoteReady : c.providerNote}</p>}
      </div>
      {!!selected && !rates.length && <p className="flex items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1.5 text-xs">
        <Check size={16} />{c.selectedCarrier}: {SHIPPING_CARRIER_OPTIONS.find(([code]) => code === selected)?.[1] || shippingCarrierBrand(selected).name}
      </p>}
      {!!rates.length && <>
        <div role="status" className="rounded-md bg-muted/40 px-2.5 py-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-semibold">
            <p>{c.totalForBoxes} {parcelCount} {c.boxUnit} · {c.lowToHigh}</p>
            {!!selected && <p className="flex items-center gap-1 text-primary">
              <Check size={14} />{c.selectedCarrier}: {SHIPPING_CARRIER_OPTIONS.find(([code]) => code === selected)?.[1] || shippingCarrierBrand(selected).name}
            </p>}
          </div>
          <p className="mt-1 text-muted-foreground">
            {environment === "uat" && <span className="font-medium text-amber-800">{c.uatNote} · </span>}{c.estimated}
          </p>
        </div>
        <div className="grid items-start gap-2 md:grid-cols-2 xl:grid-cols-4">
          {rates.map((rate) => {
            const chosen = rate.carrier_code === selected;
            const name = SHIPPING_CARRIER_OPTIONS.find(([code]) => code === rate.carrier_code)?.[1] || rate.carrier;
            return <article key={rate.carrier_code} className={`min-w-0 rounded-lg border ${chosen ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"}`}>
              <button className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50" type="button"
                disabled={!rate.available || busy} aria-pressed={chosen} aria-label={`${c.chooseCarrier} ${name}`}
                onClick={() => onSelect(rate.carrier_code)}>
                <span className="mt-0.5 flex w-12 shrink-0 justify-center"><RateLogo rate={rate} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words text-sm font-semibold leading-5">{name}</span>
                    {rate.available && rate.total !== null && <span className="shrink-0 whitespace-nowrap text-sm font-bold tabular-nums">
                      {price(rate.total)} <span className="text-xs font-normal">{c.baht}</span>
                    </span>}
                  </span>
                  <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                    {rate.available && rate.total !== null
                      ? `${rate.delivery_time || c.noDeliveryEstimate} · ${c.totalForBoxes} ${rate.parcel_count} ${c.boxUnit}`
                      : `${c.incompleteRate} (${rate.quoted_parcels}/${rate.parcel_count} ${c.boxUnit})`}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs leading-4">
                    {rate.cheapest && <span className="rounded bg-emerald-50 px-1.5 font-medium text-emerald-800">{c.lowestPrice}</span>}
                    <span className={`ml-auto flex items-center gap-1 ${chosen ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                      {chosen && <Check size={13} />}{chosen ? c.selected : c.chooseCarrier}
                    </span>
                  </span>
                </span>
              </button>
              {rate.parcel_count > 1 && <details className="px-2.5 pb-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{c.perBoxRates}</summary>
                <ul className="mt-2 space-y-1">{rate.parcels.map((parcel) => <li key={parcel.number} className="flex justify-between gap-2">
                  <span>{c.box} {parcel.number}</span><span>{parcel.total === null ? "—" : `${price(parcel.total)} ${c.baht}`}</span>
                </li>)}</ul>
              </details>}
            </article>;
          })}
        </div>
      </>}
    </section>
  );
}
