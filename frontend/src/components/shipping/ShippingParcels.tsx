import { Copy } from "lucide-react";
import { useLanguage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  emptyParcel,
  SHIPPING_BOX_DIMENSION_MAX_CM,
  shippingParcels,
  type ShippingDraft,
  type ShippingParcel,
} from "../../../../supabase/functions/_shared/shipping-domain";

const GRAMS_PER_KILOGRAM = 1000;
const MAX_BOX_WEIGHT_KG = 1000;

export default function ShippingParcels({ draft, onChange }: {
  draft: ShippingDraft;
  onChange: (parcels: ShippingParcel[]) => void;
}) {
  const { t } = useLanguage();
  const c = t.shipping;
  const parcels = shippingParcels(draft);
  return (
    <section className="rounded-xl border p-4 space-y-4">
      <div>
        <h2 className="section-heading">1. {c.parcel}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{c.parcelBeforeCarrier}</p>
      </div>
      <label className="block max-w-sm space-y-1 text-sm">
        {c.parcelTotal}
        <Input type="number" min="1" max="99" step="1" value={parcels.length}
          onChange={(e) => {
            const count = Math.max(1, Math.min(99, Math.trunc(Number(e.target.value)) || 1));
            onChange(Array.from({ length: count }, (_, i) => parcels[i] ?? emptyParcel()));
          }} />
      </label>
      <div className="space-y-3">
        {parcels.map((parcel, index) => (
          <div key={index} className="rounded-lg border bg-muted/20 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">{c.box} {index + 1}/{parcels.length}</h3>
              {index > 0 && <Button type="button" size="sm" variant="outline"
                onClick={() => onChange(parcels.map((p, i) => i === index ? { ...parcels[index - 1] } : p))}>
                <Copy size={14} />{c.copyPreviousBox}
              </Button>}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(["box_width", "box_length", "box_height", "box_weight"] as const).map((key) => {
                const overLimit = key !== "box_weight" && parcel[key] > SHIPPING_BOX_DIMENSION_MAX_CM;
                const invalidNumber = !Number.isFinite(parcel[key]) || parcel[key] <= 0;
                const invalid = overLimit || invalidNumber;
                const errorId = `shipping-box-${index}-${key}-error`;
                const value = key === "box_weight"
                  ? parcel[key] / GRAMS_PER_KILOGRAM
                  : parcel[key];
                return <label key={key} className="space-y-1 text-sm">
                  {c[key]}
                  <Input aria-label={`${c[key]} ${c.box} ${index + 1}`} type="number"
                    min="0.01"
                    max={key === "box_weight" ? MAX_BOX_WEIGHT_KG : SHIPPING_BOX_DIMENSION_MAX_CM}
                    step={key === "box_weight" ? "0.01" : "any"} value={value}
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? errorId : undefined}
                    onChange={(e) => {
                      const inputValue = Number(e.target.value);
                      const nextValue = key === "box_weight"
                        ? Math.round(inputValue * 100) * (GRAMS_PER_KILOGRAM / 100)
                        : inputValue;
                      onChange(parcels.map((p, i) => i === index ? { ...p, [key]: nextValue } : p));
                    }} />
                  {invalid && <span id={errorId} role="alert" className="block text-xs text-destructive">
                    {key === "box_weight"
                      ? c.boxWeightInvalid
                      : (c.quoteIssues as Record<string, string> | undefined)?.[key] ?? c.boxDimensionLimit}
                  </span>}
                </label>;
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{c.parcelTotalHint}</p>
    </section>
  );
}
