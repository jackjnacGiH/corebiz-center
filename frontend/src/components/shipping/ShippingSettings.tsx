import { useEffect, useState } from "react";
import { useLanguage } from "@/i18n";
import {
  shippingApi,
  type ShippingBootstrap,
  type ShippingConnectionTest,
  type ShippingUser,
  type CodAccount,
} from "@/lib/shipping-api";
import { emptyAddress } from "../../../../supabase/functions/_shared/shipping-domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import AddressFields from "./AddressFields";

function ConnectionCheckItem({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg border bg-background p-3">
      {ok ? (
        <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={18} />
      ) : (
        <AlertCircle className="mt-0.5 shrink-0 text-amber-600" size={18} />
      )}
      <span className="min-w-0 text-sm">
        <strong className="block">{label}</strong>
        <span className="text-muted-foreground">{detail}</span>
      </span>
    </div>
  );
}

export default function ShippingSettings({
  bootstrap,
  onSaved,
  onError,
}: {
  bootstrap: ShippingBootstrap;
  onSaved: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const { t, language } = useLanguage(),
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
  const [connection, setConnection] = useState<ShippingConnectionTest | null>(null),
    [connectionBusy, setConnectionBusy] = useState(false);
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
  async function testConnection() {
    setConnectionBusy(true);
    try {
      setConnection(await shippingApi.connectionTest());
    } catch (e) {
      onError(e);
    } finally {
      setConnectionBusy(false);
    }
  }
  const selectClass =
    "h-10 rounded-md border border-input bg-background px-3 w-full";
  const connectionBlockers = connection
    ? [
        connection.blockers.billing ? c.connectionBillingBlocker : null,
        connection.blockers.wallet === true
          ? c.connectionWalletBlocker
          : connection.blockers.wallet === null
            ? c.connectionWalletUnknown
            : null,
        connection.blockers.carrier === true
          ? c.connectionCarrierBlocker
          : connection.blockers.carrier === null
            ? c.connectionCarrierUnknown
            : null,
        connection.blockers.mutations ? c.connectionMutationBlocker : null,
      ].filter((message): message is string => Boolean(message))
    : [];
  const checkedAt = connection ? new Date(connection.checked_at) : null;
  const checkedAtLabel =
    checkedAt && !Number.isNaN(checkedAt.getTime())
      ? checkedAt.toLocaleString(language === "th" ? "th-TH" : "en-US")
      : "";
  return (
    <fieldset disabled={busy} className="space-y-6 min-w-0">
      <p className="text-sm text-amber-800 bg-amber-50 p-3 rounded-lg">
        {c.adminWarning}
      </p>
      {bootstrap.manager && (
        <section
          className="space-y-4 rounded-xl border border-sky-200 bg-sky-50/40 p-4"
          aria-live="polite"
          data-testid="shipping-connection-status"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-700">
                <ShieldCheck size={20} />
              </span>
              <div className="min-w-0">
                <h2 className="section-heading">{c.connectionStatus}</h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {c.connectionStatusHint}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={connectionBusy}
              onClick={() => void testConnection()}
            >
              {connectionBusy && <Loader2 className="animate-spin" size={16} />}
              {connectionBusy
                ? c.testingConnection
                : connection
                  ? c.testConnectionAgain
                  : c.testConnection}
            </Button>
          </div>
          {!connection ? (
            <p className="rounded-lg border border-dashed bg-background/70 p-3 text-sm text-muted-foreground">
              {c.connectionNotTested}
            </p>
          ) : (
            <>
              <div
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${
                  connection.ready
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-900"
                }`}
              >
                <strong>
                  {connection.ready ? c.connectionReady : c.connectionNeedsSetup}
                </strong>
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
                      connection.environment === "uat"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-emerald-100 text-emerald-900"
                    }`}
                  >
                    {connection.environment === "uat"
                      ? c.connectionUat
                      : c.connectionProduction}
                  </span>
                  {checkedAtLabel && (
                    <span className="text-xs">
                      {c.connectionCheckedAt}: {checkedAtLabel}
                    </span>
                  )}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <ConnectionCheckItem
                  label={c.connectionHmac}
                  ok={connection.hmac.ok}
                  detail={
                    connection.hmac.ok ? c.connectionHmacOk : c.connectionHmacFailed
                  }
                />
                <ConnectionCheckItem
                  label={c.connectionMerchant}
                  ok={connection.merchant.ok}
                  detail={
                    connection.merchant.ok
                      ? c.connectionMerchantOk
                      : c.connectionMerchantFailed
                  }
                />
                <ConnectionCheckItem
                  label={c.connectionCarriers}
                  ok={connection.carriers.ok}
                  detail={
                    connection.carriers.ok
                      ? `${connection.carriers.count} ${c.connectionCarrierCount}`
                      : c.connectionCarrierFailed
                  }
                />
                <ConnectionCheckItem
                  label={c.connectionRate}
                  ok={connection.rate_test.ok}
                  detail={
                    connection.rate_test.ok
                      ? `${c.connectionRateOk}${
                          connection.rate_test.total
                            ? ` · ${connection.rate_test.total} ${connection.rate_test.currency ?? ""}`
                            : ""
                        }`
                      : c.connectionRateFailed
                  }
                />
              </div>
              <div className="rounded-lg border bg-background p-3 text-sm">
                <strong>{c.connectionBlockers}</strong>
                {connectionBlockers.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {connectionBlockers.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-emerald-700">{c.connectionNoBlockers}</p>
                )}
              </div>
            </>
          )}
        </section>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await shippingApi.saveSettings(settings);
            setConnection(null);
          });
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
