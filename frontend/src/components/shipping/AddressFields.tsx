import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n";
import type { ShippingAddress } from "@/lib/shipping-api";
export default function AddressFields({
  title,
  value,
  onChange,
  prefix,
}: {
  title: string;
  value: ShippingAddress;
  onChange: (a: ShippingAddress) => void;
  prefix: string;
}) {
  const { t } = useLanguage();
  const c = t.shipping;
  return (
    <section className="space-y-3 min-w-0">
      <h2 className="font-semibold">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(Object.keys(value) as (keyof ShippingAddress)[]).map((key) => (
          <label
            key={key}
            htmlFor={`${prefix}-${key}`}
            className={
              key === "address"
                ? "sm:col-span-2 text-sm space-y-1"
                : "text-sm space-y-1"
            }
          >
            <span>{c[key]}</span>
            <Input
              id={`${prefix}-${key}`}
              value={value[key]}
              maxLength={key === "address" ? 500 : 150}
              autoComplete="off"
              type={key === "email" ? "email" : "text"}
              inputMode={
                key === "telephone1"
                  ? "tel"
                  : key === "postcode"
                    ? "numeric"
                    : undefined
              }
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
