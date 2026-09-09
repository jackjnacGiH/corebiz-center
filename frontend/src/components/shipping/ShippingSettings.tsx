import { useEffect, useState } from "react";
import { useLanguage } from "@/i18n";
import {
  shippingApi,
  type ShippingBootstrap,
  type ShippingUser,
  type CodAccount,
} from "@/lib/shipping-api";
import { emptyAddress } from "../../../../supabase/functions/_shared/shipping-domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AddressFields from "./AddressFields";

export default function ShippingSettings({
  bootstrap,
  onSaved,
  onError,
}: {
  bootstrap: ShippingBootstrap;
  onSaved: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const { t } = useLanguage(),
    c = t.shipping;
  const [settings, setSettings] = useState({
    ...bootstrap.settings,
    origin: { ...emptyAddress(), ...bootstrap.settings.origin },
  });
  const [users, setUsers] = useState<ShippingUser[]>([]),
    [grants, setGrants] = useState<string[]>([]),
    [accounts, setAccounts] = useState<CodAccount[]>([]);
  const [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [account, setAccount] = useState<CodAccount>({
    id: crypto.randomUUID(),
    label: "",
    provider_account_id: "",
    active: false,
  });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setLoaded(false);
    shippingApi
      .admin(page)
      .then((r) => {
        if (current) {
          setUsers(r.users);
          setGrants(r.grants.map((x) => x.user_id));
          setAccounts(r.accounts);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (current) onError(e);
      });
    return () => {
      current = false;
    };
  }, [page, version, onError]);
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
      setVersion((v) => v + 1);
      await onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const selectClass =
    "h-10 rounded-md border border-input bg-background px-3 w-full";
  return (
    <fieldset disabled={busy} className="space-y-6 min-w-0">
      <p className="text-sm text-amber-800 bg-amber-50 p-3 rounded-lg">
        {c.adminWarning}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => shippingApi.saveSettings(settings));
        }}
        className="space-y-4 border rounded-xl p-4"
      >
        <h2 className="section-heading">{c.settings}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm space-y-1">
            {c.environment}
            <select
              className={selectClass}
              value={settings.environment}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  environment: e.target.value as "uat" | "production",
                })
              }
            >
              <option value="uat">UAT</option>
              <option value="production">Production</option>
            </select>
          </label>
          <label className="text-sm space-y-1">
            {c.billing_mode}
            <select
              className={selectClass}
              value={settings.billing_mode}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  billing_mode: e.target.value as typeof settings.billing_mode,
                })
              }
            >
              {(["unconfirmed", "prepaid", "postpaid"] as const).map((x) => (
                <option key={x} value={x}>
                  {c[x]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm space-y-1">
            {c.merchant_code}
            <Input
              value={settings.merchant_code}
              maxLength={100}
              onChange={(e) =>
                setSettings({ ...settings, merchant_code: e.target.value })
              }
            />
          </label>
        </div>
        <AddressFields
          prefix="settings-origin"
          title={c.origin}
          value={settings.origin}
          onChange={(origin) => setSettings({ ...settings, origin })}
        />
        <Button type="submit">{c.saveSettings}</Button>
      </form>
      <section className="border rounded-xl p-4 space-y-3">
        <h2 className="section-heading">{c.permissions}</h2>
        <p className="text-sm text-muted-foreground">{c.grantHint}</p>
        {!loaded ? (
          <p>{c.loading}</p>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between gap-3 border-b py-2"
            >
              <span className="min-w-0 break-words">
                {u.full_name || u.id}
                <small className="block text-muted-foreground">{u.role}</small>
              </span>
              {u.role === "staff" && (
                <Button
                  variant="outline"
                  disabled={!u.is_active && !grants.includes(u.id)}
                  onClick={() =>
                    void run(() =>
                      shippingApi.permission(u.id, !grants.includes(u.id)),
                    )
                  }
                >
                  {grants.includes(u.id) ? c.revoke : c.grant}
                </Button>
              )}
            </div>
          ))
        )}
      </section>
      <form
        className="border rounded-xl p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await shippingApi.saveCod(account);
            setAccount({
              id: crypto.randomUUID(),
              label: "",
              provider_account_id: "",
              active: false,
            });
          });
        }}
      >
        <h2 className="section-heading">{c.codAccounts}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            {c.label}
            <Input
              required
              maxLength={150}
              value={account.label}
              onChange={(e) =>
                setAccount({ ...account, label: e.target.value })
              }
            />
          </label>
          <label className="text-sm space-y-1">
            {c.providerAccount}
            <Input
              required
              maxLength={100}
              value={account.provider_account_id}
              onChange={(e) =>
                setAccount({ ...account, provider_account_id: e.target.value })
              }
            />
          </label>
        </div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            checked={account.active}
            onChange={(e) =>
              setAccount({ ...account, active: e.target.checked })
            }
          />
          {c.active}
        </label>
        <Button type="submit" disabled={!settings.merchant_code}>
          {c.saveAccount}
        </Button>
        {accounts.map((a) => (
          <div key={a.id} className="flex justify-between gap-2 border-t pt-2">
            <span>
              {a.label} {a.active ? "✓" : ""}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAccount(a)}
            >
              {t.common.edit}
            </Button>
          </div>
        ))}
      </form>
      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          {c.previous}
        </Button>
        <span>{page + 1}</span>
        <Button
          variant="outline"
          disabled={users.length < 50 && accounts.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          {c.next}
        </Button>
      </div>
    </fieldset>
  );
}
