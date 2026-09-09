import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n";
import { lookupZipcode, type ThaiAddressEntry } from "@/lib/thaiAddress";
import type { ShippingAddress } from "@/lib/shipping-api";

export default function AddressFields({
  title,
  value,
  onChange,
  prefix,
  beforeFields,
}: {
  title: string;
  value: ShippingAddress;
  onChange: (a: ShippingAddress) => void;
  prefix: string;
  beforeFields?: ReactNode;
}) {
  const { t } = useLanguage();
  const c = t.shipping;
  const [zipOptions, setZipOptions] = useState<ThaiAddressEntry[]>([]);
  const [zipSearching, setZipSearching] = useState(false);
  const [zipNotFound, setZipNotFound] = useState(false);
  const latestValue = useRef(value);
  useEffect(() => {
    latestValue.current = value;
  }, [value]);

  async function runZipLookup(postcode: string) {
    const clean = postcode.trim();
    if (!/^\d{5}$/.test(clean)) {
      setZipOptions([]);
      setZipNotFound(false);
      return;
    }
    setZipSearching(true);
    setZipNotFound(false);
    try {
      const matches = await lookupZipcode(clean);
      if (!matches.length) {
        setZipOptions([]);
        setZipNotFound(true);
        return;
      }
      const first = matches[0];
      onChange({
        ...latestValue.current,
        postcode: clean,
        county: matches.length === 1 ? first.subdistrict : "",
        city: first.district,
        state: first.province,
      });
      setZipOptions(matches.length > 1 ? matches : []);
    } finally {
      setZipSearching(false);
    }
  }

  const field = (
    key: "company" | "fullname" | "telephone1" | "email" | "address" | "state" | "city",
    className = "",
  ) => (
    <label
      htmlFor={`${prefix}-${key}`}
      className={`text-sm space-y-1 ${className}`}
    >
      <span>{c[key]}</span>
      <Input
        id={`${prefix}-${key}`}
        value={value[key] ?? ""}
        maxLength={key === "address" ? 500 : 150}
        autoComplete="off"
        type={key === "email" ? "email" : "text"}
        placeholder={key === "fullname" ? c.contactNameHint : undefined}
        inputMode={key === "telephone1" ? "tel" : undefined}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <section className="space-y-3 min-w-0">
      <h2 className="section-heading">{title}</h2>
      {beforeFields}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {field("fullname")}
        {field("telephone1")}
        {field("company", "sm:col-span-2")}
        {field("address", "sm:col-span-2")}
        <label
          htmlFor={`${prefix}-postcode`}
          className="text-sm space-y-1"
        >
          <span>{c.postcode}</span>
          <div className="flex gap-1.5">
            <Input
              id={`${prefix}-postcode`}
              value={value.postcode}
              maxLength={5}
              autoComplete="postal-code"
              inputMode="numeric"
              placeholder="10330"
              onChange={(e) => {
                const postcode = e.target.value.replace(/\D/g, "").slice(0, 5);
                onChange({ ...value, postcode });
                setZipNotFound(false);
                if (postcode.length === 5) void runZipLookup(postcode);
              }}
              onBlur={() => void runZipLookup(value.postcode)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runZipLookup(value.postcode);
                }
              }}
            />
            <button
              type="button"
              onClick={() => void runZipLookup(value.postcode)}
              disabled={zipSearching}
              title={c.zipLookup}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md border bg-background hover:bg-muted disabled:opacity-50"
            >
              {zipSearching ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Search size={16} />
              )}
            </button>
          </div>
          {zipNotFound && (
            <span className="block text-xs text-amber-700">
              {c.zipNotFound}
            </span>
          )}
        </label>
        {field("state")}
        {field("city")}
        <label
          htmlFor={`${prefix}-county`}
          className="text-sm space-y-1"
        >
          <span>{c.county}</span>
          {zipOptions.length > 1 ? (
            <select
              id={`${prefix}-county`}
              value={value.county}
              className="h-10 w-full rounded-md border border-input bg-background px-3"
              onChange={(e) => {
                const match = zipOptions.find(
                  (option) => option.subdistrict === e.target.value,
                );
                onChange({
                  ...latestValue.current,
                  county: e.target.value,
                  city: match?.district ?? latestValue.current.city,
                  state: match?.province ?? latestValue.current.state,
                });
                if (e.target.value) setZipOptions([]);
              }}
            >
              <option value="">{c.chooseSubdistrict}</option>
              {zipOptions.map((option) => (
                <option
                  key={`${option.subdistrict}-${option.district}`}
                  value={option.subdistrict}
                >
                  {option.subdistrict}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${prefix}-county`}
              value={value.county}
              maxLength={150}
              autoComplete="off"
              onChange={(e) => onChange({ ...value, county: e.target.value })}
            />
          )}
        </label>
      </div>
      <details className="rounded-md border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">
          {c.additionalContact}
        </summary>
        <div className="mt-3 space-y-2">
          {field("email", "block")}
          <p className="text-xs text-muted-foreground">{c.emailHint}</p>
        </div>
      </details>
    </section>
  );
}
