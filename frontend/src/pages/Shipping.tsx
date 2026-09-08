import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Truck, Plus, RefreshCw, ArrowLeft } from "lucide-react";
import { useLanguage } from "@/i18n";
import {
  shippingApi,
  type Shipment,
  type ShippingDraft,
  type ShippingBootstrap,
  type ShippingEvent,
} from "@/lib/shipping-api";
import {
  emptyDraft,
  emptyAddress,
  parseDraft,
  readyIssues,
} from "../../../supabase/functions/_shared/shipping-domain";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AddressFields from "@/components/shipping/AddressFields";
import ShippingSettings from "@/components/shipping/ShippingSettings";

export default function Shipping() {
  const { t, language } = useLanguage(),
    c = t.shipping;
  const [params, setParams] = useSearchParams();
  const [bootstrap, setBootstrap] = useState<ShippingBootstrap | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [rows, setRows] = useState<Shipment[]>([]),
    [count, setCount] = useState(0),
    [page, setPage] = useState(0),
    [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "editor" | "settings">("list"),
    [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ShippingDraft>(emptyDraft),
    [shipment, setShipment] = useState<Shipment | null>(null),
    [baseline, setBaseline] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null),
    [orderCode, setOrderCode] = useState(""),
    [orderSearch, setOrderSearch] = useState("");
  const [orderOptions, setOrderOptions] = useState<
      { id: string; code: string }[]
    >([]),
    [selectedOrder, setSelectedOrder] = useState("");
  const [events, setEvents] = useState<ShippingEvent[]>([]),
    [rates, setRates] = useState<
      { carrier: string; total: string; delivery_time: string }[]
    >([]);
  const [labelLink, setLabelLink] = useState("");
  const draftId = useRef(crypto.randomUUID());
  const handledOrder = useRef("");
  const dirty = view === "editor" && JSON.stringify(draft) !== baseline;
  const reportError = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "shipping_error");
    setNotice("");
  }, []);
  const reload = useCallback(async () => {
    const b = await shippingApi.bootstrap();
    setBootstrap(b);
  }, []);
  useEffect(() => {
    let active = true;
    shippingApi
      .bootstrap()
      .then((b) => {
        if (active) setBootstrap(b);
      })
      .catch((e) => {
        if (active) reportError(e);
      });
    return () => {
      active = false;
    };
  }, [reportError]);
  useEffect(() => {
    if (!bootstrap || view !== "list") return;
    let active = true;
    shippingApi
      .list(page, search)
      .then((r) => {
        if (active) {
          setRows(r.shipments);
          setCount(r.count);
        }
      })
      .catch((e) => {
        if (active) reportError(e);
      });
    return () => {
      active = false;
    };
  }, [bootstrap, page, search, view, reportError]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const editResult = (s: Shipment) => {
    setShipment(s);
    setDraft(s.draft);
    setBaseline(JSON.stringify(s.draft));
    setOrderId(s.order_id);
    setOrderCode(s.order_code ?? "");
    setRates([]);
    setLabelLink("");
  };
  useEffect(() => {
    const id = params.get("order");
    if (!bootstrap || !id || handledOrder.current === id) return;
    handledOrder.current = id;
    setBusy(true);
    shippingApi
      .orderDraft(id)
      .then((r) => {
        const d = {
          ...r.draft,
          origin: { ...emptyAddress(), ...bootstrap.settings.origin },
        };
        setDraft(d);
        setBaseline("");
        setOrderId(id);
        setOrderCode(r.order_code);
        setShipment(null);
        draftId.current = crypto.randomUUID();
        setView("editor");
        if (r.previous.length) setNotice(c.duplicateOrder);
      })
      .catch(reportError)
      .finally(() => setBusy(false));
  }, [bootstrap, params, c.duplicateOrder, reportError]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }
  function leave(next: "list" | "settings") {
    if (dirty && !window.confirm(c.discard)) return;
    setView(next);
    setError("");
    setNotice("");
    setParams({});
  }
  function create() {
    const d = {
      ...emptyDraft(),
      origin: { ...emptyAddress(), ...bootstrap?.settings.origin },
    };
    setDraft(d);
    setBaseline(JSON.stringify(d));
    setShipment(null);
    setOrderId(null);
    setOrderCode("");
    setEvents([]);
    setRates([]);
    setNotice("");
    setError("");
    draftId.current = crypto.randomUUID();
    setView("editor");
  }
  const change = <K extends keyof ShippingDraft>(
    key: K,
    value: ShippingDraft[K],
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setRates([]);
  };
  let issues: string[] = [];
  try {
    issues = readyIssues(parseDraft(draft));
  } catch {
    issues = ["invalid_payload"];
  }
  const locked = !!shipment && shipment.status !== "draft";
  const errorMessage =
    error === "forbidden"
      ? c.noPermission
      : error === "shipping_not_installed"
        ? c.notInstalled
        : error === "conflict"
          ? c.conflict
          : error === "provider_not_ready"
            ? c.prepareOnly
            : error === "outcome_unknown"
              ? c.unknown
              : error.startsWith("invalid_") || error === "shipment_incomplete"
                ? c.missing
                : c.genericError;
  async function save() {
    const d = parseDraft(draft);
    const r = shipment
      ? await shippingApi.save(shipment, d)
      : await shippingApi.create(draftId.current, d, orderId);
    editResult(r.shipment);
    setNotice(c.saved);
  }
  async function loadOrder() {
    if (!selectedOrder) return;
    if (dirty && !window.confirm(c.discard)) return;
    const r = await shippingApi.orderDraft(selectedOrder);
    setDraft({
      ...r.draft,
      origin: { ...emptyAddress(), ...bootstrap?.settings.origin },
    });
    setBaseline("");
    setOrderId(selectedOrder);
    setOrderCode(r.order_code);
    setRates([]);
    if (r.previous.length) setNotice(c.duplicateOrder);
  }
  const status = (s: Shipment) => c.statuses[s.status];
  const selectClass =
    "h-10 w-full border border-input rounded-md bg-background px-3";
  return (
    <div className="space-y-5 min-w-0" data-testid="shipping-page">
      <PageHeader
        title={c.title}
        subtitle={c.subtitle}
        icon={<Truck size={20} />}
        actions={
          <>
            {view !== "list" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => leave("list")}
              >
                <ArrowLeft size={16} />
                {c.back}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(reload)}
            >
              <RefreshCw size={16} />
              {c.refresh}
            </Button>
            {bootstrap?.manager && view !== "settings" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => leave("settings")}
              >
                {c.settings}
              </Button>
            )}
            {bootstrap && view === "list" && (
              <Button disabled={busy} onClick={create}>
                <Plus size={16} />
                {c.newDraft}
              </Button>
            )}
          </>
        }
      />
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 text-red-800 p-3">
          {errorMessage}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg bg-blue-50 text-blue-800 p-3">
          {notice}
        </div>
      )}
      {!bootstrap && !error && <p>{c.loading}</p>}
      {bootstrap && (
        <>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <strong>{bootstrap.sendReady ? c.ready : c.prepareOnly}</strong>
            <span className="ml-2 uppercase">
              {bootstrap.settings.environment}
            </span>
            <p className="mt-1 text-muted-foreground">{c.providerNote}</p>
          </div>
          {view === "settings" && bootstrap.manager && (
            <ShippingSettings
              bootstrap={bootstrap}
              onSaved={reload}
              onError={reportError}
            />
          )}
          {view === "list" && (
            <section className="space-y-3">
              <Input
                aria-label={c.search}
                placeholder={c.search}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
              {!rows.length ? (
                <p className="py-12 text-center text-muted-foreground">
                  {c.empty}
                </p>
              ) : (
                <div className="grid gap-3">
                  {rows.map((s) => (
                    <article
                      key={s.id}
                      className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium break-all text-sm">
                          {s.reference_no}
                        </p>
                        <p className="text-sm text-muted-foreground break-words">
                          {s.order_code || c.manual} ·{" "}
                          {s.draft.destination.fullname || "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(s.created_at).toLocaleString(
                            language === "th" ? "th-TH" : "en-GB",
                          )}{" "}
                          · {s.tracking_number || "—"}
                        </p>
                      </div>
                      <span className="rounded-full bg-muted px-3 py-1 text-sm">
                        {status(s)}
                      </span>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const r = await shippingApi.get(s.id);
                            editResult(r.shipment);
                            setEvents(r.events);
                            setView("editor");
                          })
                        }
                      >
                        {c.open}
                      </Button>
                    </article>
                  ))}
                </div>
              )}
              <div className="flex justify-between items-center">
                <Button
                  variant="outline"
                  disabled={!page || busy}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {c.previous}
                </Button>
                <span className="text-sm">
                  {page + 1} / {Math.max(1, Math.ceil(count / 25))}
                </span>
                <Button
                  variant="outline"
                  disabled={(page + 1) * 25 >= count || busy}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {c.next}
                </Button>
              </div>
            </section>
          )}
          {view === "editor" && (
            <div className="space-y-4">
              {shipment && (
                <div className="break-all text-sm">
                  <strong>{shipment.reference_no}</strong> · {status(shipment)}
                  {shipment.tracking_number && (
                    <p>
                      {c.tracking}: {shipment.tracking_number}
                    </p>
                  )}
                </div>
              )}
              {shipment &&
                ["submitting", "outcome_unknown"].includes(shipment.status) && (
                  <p
                    role="alert"
                    className="bg-amber-50 text-amber-900 p-3 rounded-lg"
                  >
                    {c.unknown}
                  </p>
                )}
              {!shipment && (
                <fieldset
                  disabled={busy}
                  className="border rounded-xl p-4 space-y-3"
                >
                  <h2 className="font-semibold">
                    {c.source}: {orderCode || c.manual}
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="sm:max-w-xs"
                      aria-label={c.orderSearch}
                      placeholder={c.orderSearch}
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() =>
                        void run(async () => {
                          const r = await shippingApi.orderOptions(orderSearch);
                          setOrderOptions(r.orders);
                        })
                      }
                    >
                      {t.common.search}
                    </Button>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap gap-2">
                    <select
                      aria-label={c.chooseOrder}
                      className={selectClass}
                      value={selectedOrder}
                      onChange={(e) => setSelectedOrder(e.target.value)}
                    >
                      <option value="">{c.chooseOrder}</option>
                      {orderOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.code}
                        </option>
                      ))}
                    </select>
                    <Button
                      disabled={!selectedOrder}
                      variant="outline"
                      onClick={() => void run(loadOrder)}
                    >
                      {c.loadOrder}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!dirty || window.confirm(c.discard)) {
                          setOrderId(null);
                          setOrderCode("");
                          setDraft({
                            ...emptyDraft(),
                            origin: {
                              ...emptyAddress(),
                              ...bootstrap.settings.origin,
                            },
                          });
                          setBaseline("");
                        }
                      }}
                    >
                      {c.manual}
                    </Button>
                  </div>
                </fieldset>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(save);
                }}
                className="space-y-4"
              >
                <fieldset disabled={busy || locked} className="space-y-4">
                  <label className="block text-sm space-y-1">
                    {c.purpose}
                    <Input
                      value={draft.purpose}
                      maxLength={300}
                      onChange={(e) => change("purpose", e.target.value)}
                    />
                  </label>
                  <div className="grid xl:grid-cols-2 gap-6 rounded-xl border p-4">
                    <AddressFields
                      prefix="sender"
                      title={c.origin}
                      value={draft.origin}
                      onChange={(a) => change("origin", a)}
                    />
                    <AddressFields
                      prefix="recipient"
                      title={c.destination}
                      value={draft.destination}
                      onChange={(a) => change("destination", a)}
                    />
                  </div>
                  <section className="rounded-xl border p-4 space-y-3">
                    <h2 className="font-semibold">{c.parcel}</h2>
                    <label className="block text-sm space-y-1">
                      {c.carrier_code}
                      <Input
                        value={draft.carrier_code}
                        maxLength={80}
                        onChange={(e) => change("carrier_code", e.target.value)}
                      />
                    </label>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {(
                        [
                          "box_width",
                          "box_height",
                          "box_length",
                          "box_weight",
                        ] as const
                      ).map((k) => (
                        <label key={k} className="text-sm space-y-1">
                          {c[k]}
                          <Input
                            type="number"
                            min="0"
                            step={k === "box_weight" ? 1 : "any"}
                            value={draft[k]}
                            onChange={(e) => change(k, Number(e.target.value))}
                          />
                        </label>
                      ))}
                    </div>
                  </section>
                  <section className="rounded-xl border p-4 space-y-3">
                    <h2 className="font-semibold">{c.items}</h2>
                    {draft.products.map((item, index) => (
                      <div
                        key={index}
                        className="border-b pb-4 grid grid-cols-2 lg:grid-cols-6 gap-2"
                      >
                        {(
                          ["name", "code", "qty", "price", "weight"] as const
                        ).map((k) => (
                          <label
                            key={k}
                            className={
                              "text-sm space-y-1 " +
                              (k === "name" ? "col-span-2 lg:col-span-2" : "")
                            }
                          >
                            <span>{k === "name" ? c.itemName : c[k]}</span>
                            <Input
                              aria-label={`${k === "name" ? c.itemName : c[k]} ${index + 1}`}
                              value={item[k]}
                              type={
                                ["qty", "weight"].includes(k)
                                  ? "number"
                                  : "text"
                              }
                              inputMode={k === "price" ? "decimal" : undefined}
                              min="0"
                              step="1"
                              maxLength={100}
                              onChange={(e) =>
                                change(
                                  "products",
                                  draft.products.map((v, i) =>
                                    i === index
                                      ? {
                                          ...v,
                                          [k]: ["qty", "weight"].includes(k)
                                            ? Number(e.target.value)
                                            : e.target.value,
                                        }
                                      : v,
                                  ),
                                )
                              }
                            />
                          </label>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={draft.products.length === 1}
                          onClick={() =>
                            change(
                              "products",
                              draft.products.filter((_, i) => i !== index),
                            )
                          }
                        >
                          {c.remove}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={draft.products.length >= 100}
                      onClick={() =>
                        change("products", [
                          ...draft.products,
                          {
                            name: "",
                            code: "",
                            qty: 1,
                            price: "0.00",
                            weight: 0,
                          },
                        ])
                      }
                    >
                      {c.addItem}
                    </Button>
                  </section>
                  <section className="rounded-xl border p-4 space-y-3">
                    <h2 className="font-semibold">{c.cod}</h2>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <label className="text-sm space-y-1">
                        {c.cod_amount}
                        <Input
                          inputMode="decimal"
                          value={draft.cod_amount}
                          onChange={(e) => change("cod_amount", e.target.value)}
                        />
                        <small>{c.amountHint}</small>
                      </label>
                      <label className="text-sm space-y-1">
                        {c.codAccount}
                        <select
                          className={selectClass}
                          value={draft.cod_account_id ?? ""}
                          onChange={(e) =>
                            change("cod_account_id", e.target.value || null)
                          }
                        >
                          <option value="">{c.noCod}</option>
                          {bootstrap.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className="text-sm text-muted-foreground">{c.codHint}</p>
                  </section>
                  {!locked && <Button type="submit">{c.save}</Button>}
                </fieldset>
              </form>
              {dirty && <p className="text-sm text-amber-800">{c.dirty}</p>}
              {issues.length > 0 && !locked && (
                <p className="text-sm text-muted-foreground">{c.missing}</p>
              )}
              {shipment && (
                <div className="flex flex-wrap gap-2">
                  {shipment.status === "draft" && (
                    <>
                      <Button
                        variant="outline"
                        disabled={
                          busy ||
                          dirty ||
                          issues.length > 0 ||
                          !bootstrap.readReady
                        }
                        onClick={() =>
                          void run(async () => {
                            const r = await shippingApi.quote(shipment);
                            setRates(r.rates);
                          })
                        }
                      >
                        {c.quote}
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          dirty ||
                          issues.length > 0 ||
                          !bootstrap.sendReady
                        }
                        onClick={() => {
                          if (window.confirm(c.confirmSubmit))
                            void run(async () =>
                              editResult(
                                (await shippingApi.action("submit", shipment))
                                  .shipment,
                              ),
                            );
                        }}
                      >
                        {c.submit}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || dirty}
                        onClick={() => {
                          if (window.confirm(c.confirmArchive))
                            void run(async () =>
                              editResult(
                                (await shippingApi.action("archive", shipment))
                                  .shipment,
                              ),
                            );
                        }}
                      >
                        {c.archive}
                      </Button>
                    </>
                  )}
                  {shipment.tracking_number && (
                    <>
                      <Button
                        variant="outline"
                        disabled={busy || !bootstrap.readReady}
                        onClick={() =>
                          void run(async () => {
                            const r = await shippingApi.print(shipment);
                            setLabelLink(r.link);
                          })
                        }
                      >
                        {c.print}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || !bootstrap.readReady}
                        onClick={() =>
                          void run(async () =>
                            editResult(
                              (
                                await shippingApi.action(
                                  "refresh_status",
                                  shipment,
                                )
                              ).shipment,
                            ),
                          )
                        }
                      >
                        {c.poll}
                      </Button>
                    </>
                  )}
                </div>
              )}
              {labelLink && shipment?.tracking_number && (
                <a
                  className="inline-block underline text-primary"
                  href={labelLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {c.print} ↗
                </a>
              )}
              {!!rates.length && (
                <div className="p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">{c.estimated}</p>
                  {rates.map((r, i) => (
                    <p key={i}>
                      {r.carrier} · {r.total} · {r.delivery_time}
                    </p>
                  ))}
                </div>
              )}
              {!!events.length && (
                <section className="border rounded-xl p-4">
                  <h2 className="font-semibold">{c.history}</h2>
                  {events.map((e, i) => (
                    <p key={i} className="text-sm text-muted-foreground py-1">
                      {new Date(e.created_at).toLocaleString()} ·{" "}
                      {e.old_status || "—"} → {e.new_status || "—"}
                    </p>
                  ))}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
