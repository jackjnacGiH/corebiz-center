import { Copy } from "lucide-react";
import { useLanguage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyParcel, shippingParcels, type ShippingDraft, type ShippingParcel } from "../../../../supabase/functions/_shared/shipping-domain";

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
              {(["box_width", "box_height", "box_length", "box_weight"] as const).map((key) => (
                <label key={key} className="space-y-1 text-sm">
                  {c[key]}
                  <Input aria-label={`${c[key]} ${c.box} ${index + 1}`} type="number" min="0"
                    max={key === "box_weight" ? 1000000 : 1000}
                    step={key === "box_weight" ? 1 : "any"} value={parcel[key]}
                    onChange={(e) => onChange(parcels.map((p, i) => i === index ? { ...p, [key]: Number(e.target.value) } : p))} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{c.parcelTotalHint}</p>
    </section>
  );
}
