import { useState } from "react";
import { Check, RefreshCw, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n";
import { SHIPPING_CARRIER_OPTIONS, shippingCarrierBrand } from "@/lib/shipping-carriers";
import type { ShippingRate } from "../../../../supabase/functions/_shared/shipping-rates";

function RateLogo({ rate }: { rate: ShippingRate }) {
  const brand = shippingCarrierBrand(rate.carrier_code);
  const [failed, setFailed] = useState(false);
  const url = brand.logoUrl || rate.logo;
  return url && !failed ? <img src={url} alt={rate.carrier} className="h-10 w-24 object-contain" onError={() => setFailed(true)} />
    : <span className="text-lg font-black" style={{ color: brand.accent }}>{brand.shortName}</span>;
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
    <section className="rounded-xl border p-4 space-y-4" aria-label={c.compareRates}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">2. {c.compareAndChoose}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{c.compareHint}</p>
        </div>
        <Button type="button" disabled={busy || !readReady || !!blockers.length} onClick={onCompare} aria-describedby="shipping-quote-status">
          <RefreshCw size={16} className={busy ? "animate-spin" : ""} />{c.compareRates}
        </Button>
      </div>
      <div id="shipping-quote-status" className="text-sm" aria-live="polite">
        {blockers.length > 0 ? <>
          <p className="font-medium">{c.quoteMissing}</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">{blockers.map((message) => <li key={message}>{message}</li>)}</ul>
        </> : <p className="text-muted-foreground">{readReady ? c.quoteReady : c.providerNote}</p>}
      </div>
      {!!selected && <p className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-sm">
        <Check size={16} />{c.selectedCarrier}: {SHIPPING_CARRIER_OPTIONS.find(([code]) => code === selected)?.[1] || shippingCarrierBrand(selected).name}
      </p>}
      {!!rates.length && <>
        <div role="status" className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
          <p className="font-semibold">{c.totalForBoxes} {parcelCount} {c.boxUnit} · {c.lowToHigh}</p>
          {environment === "uat" && <p className="font-medium text-amber-800">{c.uatNote}</p>}
          <p className="text-muted-foreground">{c.estimated}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rates.map((rate) => {
            const chosen = rate.carrier_code === selected;
            const name = SHIPPING_CARRIER_OPTIONS.find(([code]) => code === rate.carrier_code)?.[1] || rate.carrier;
            return <article key={rate.carrier_code} className={`flex flex-col rounded-xl border-2 p-4 ${chosen ? "border-primary bg-primary/5" : "border-border"}`}>
              <div className="mb-3 flex min-h-10 items-center justify-between gap-2">
                <RateLogo rate={rate} />
                {rate.cheapest && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">{c.lowestPrice}</span>}
              </div>
              <h3 className="font-semibold">{name}</h3>
              {rate.available && rate.total !== null ? <>
                <p className="mt-3 text-2xl font-bold tabular-nums">{price(rate.total)} <span className="text-sm font-medium">{c.baht}</span></p>
                <p className="text-xs text-muted-foreground">{c.totalForBoxes} {rate.parcel_count} {c.boxUnit}</p>
                <p className="mt-2 text-sm text-muted-foreground">{rate.delivery_time || c.noDeliveryEstimate}</p>
              </> : <p className="my-3 text-sm text-muted-foreground">{c.incompleteRate} ({rate.quoted_parcels}/{rate.parcel_count} {c.boxUnit})</p>}
              {rate.parcel_count > 1 && <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{c.perBoxRates}</summary>
                <ul className="mt-2 space-y-1">{rate.parcels.map((parcel) => <li key={parcel.number} className="flex justify-between gap-2">
                  <span>{c.box} {parcel.number}</span><span>{parcel.total === null ? "—" : `${price(parcel.total)} ${c.baht}`}</span>
                </li>)}</ul>
              </details>}
              <Button className="mt-4 w-full" type="button" variant={chosen ? "default" : "outline"}
                disabled={!rate.available || busy} aria-pressed={chosen} aria-label={`${c.chooseCarrier} ${name}`}
                onClick={() => onSelect(rate.carrier_code)}>
                {chosen ? <Check size={16} /> : <Truck size={16} />}{chosen ? c.selected : c.chooseCarrier}
              </Button>
            </article>;
          })}
        </div>
      </>}
    </section>
  );
}
