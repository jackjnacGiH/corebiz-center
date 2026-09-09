import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Truck,
  Plus,
  RefreshCw,
  ArrowLeft,
  Printer,
  X,
  Copy,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";
import { useLanguage } from "@/i18n";
import {
  shippingApi,
  type Shipment,
  type ShippingDraft,
  type ShippingBootstrap,
  type ShippingEvent,
  type ShippingRecipientOption,
  type ShippingProductOption,
} from "@/lib/shipping-api";
import {
  emptyDraft,
  emptyAddress,
  parseDraft,
  readyIssues,
  quoteIssues,
  type QuoteIssue,
  type ShippingParcel,
  summarizeShippingItems,
  shippingQuoteKey,
} from "../../../supabase/functions/_shared/shipping-domain";
import type { ShippingRate } from "../../../supabase/functions/_shared/shipping-rates";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AddressFields from "@/components/shipping/AddressFields";
import ShippingSettings from "@/components/shipping/ShippingSettings";
import ShippingParcels from "@/components/shipping/ShippingParcels";
import ShippingRateComparison from "@/components/shipping/ShippingRateComparison";
import ShipmentListCard from "@/components/shipping/ShipmentListCard";
import {
  shippingTrackingUrl,
} from "@/lib/shipping-carriers";
import { printElement } from "@/lib/print";

type ShippingLabelModule = typeof import("@/components/shipping/ShippingLabel");
let labelModulePromise: Promise<ShippingLabelModule> | undefined;
const loadShippingLabel = () => {
  // The list does not need barcode code. Share an editor warm-up with preview.
  labelModulePromise ??= import("@/components/shipping/ShippingLabel").catch((error) => {
    labelModulePromise = undefined;
    throw error;
  });
  return labelModulePromise;
};

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard_unavailable");
}

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
  const [recipientSearch, setRecipientSearch] = useState(""),
    [recipientOptions, setRecipientOptions] = useState<
      ShippingRecipientOption[]
    >([]),
    [recipientBusy, setRecipientBusy] = useState(false),
    [recipientSearched, setRecipientSearched] = useState(false);
  const [activeProductIndex, setActiveProductIndex] = useState<number | null>(
      null,
    ),
    [productOptions, setProductOptions] = useState<ShippingProductOption[]>([]),
    [productBusy, setProductBusy] = useState(false),
    [productSearched, setProductSearched] = useState(false);
  const [events, setEvents] = useState<ShippingEvent[]>([]),
    [rates, setRates] = useState<ShippingRate[]>([]);
  const [labelLink, setLabelLink] = useState("");
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelModule, setLabelModule] = useState<ShippingLabelModule | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listRevision, setListRevision] = useState(0);
  const draftId = useRef(crypto.randomUUID());
  const handledOrder = useRef("");
  const recipientRequest = useRef(0);
  const productRequest = useRef(0);
  const deletingDraft = useRef(false);
  const serializedDraft = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = view === "editor" && serializedDraft !== baseline;
  const reportError = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "shipping_error");
    setNotice("");
  }, []);
  const reload = useCallback(async () => {
    const b = await shippingApi.bootstrap();
    setBootstrap(b);
    setListRevision((revision) => revision + 1);
  }, []);
  const resetRecipientLookup = useCallback(() => {
    recipientRequest.current += 1;
    setRecipientSearch("");
    setRecipientOptions([]);
    setRecipientSearched(false);
    setRecipientBusy(false);
  }, []);
  const resetProductLookup = useCallback(() => {
    productRequest.current += 1;
    setActiveProductIndex(null);
    setProductOptions([]);
    setProductSearched(false);
    setProductBusy(false);
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
    // Both endpoints authorize independently; keep display gated by bootstrap,
    // but let list data arrive in parallel instead of waiting for another trip.
    if (view !== "list") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setListLoading(true);
      shippingApi.list(page, search)
        .then((r) => {
          if (active) {
            setRows(r.shipments);
            setCount(r.count);
          }
        })
        .catch((e) => { if (active) reportError(e); })
        .finally(() => { if (active) setListLoading(false); });
    }, search.trim() ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [listRevision, page, search, view, reportError]);
  useEffect(() => {
    if (view !== "editor" || labelModule) return;
    let active = true;
    void loadShippingLabel().then((module) => {
      if (active) setLabelModule(module);
    }).catch(() => { /* Preview can retry an interrupted background download. */ });
    return () => { active = false; };
  }, [view, labelModule]);
  useEffect(() => {
    const query = recipientSearch.trim();
    if (view !== "editor" || query.length < 3) {
      recipientRequest.current += 1;
      setRecipientOptions([]);
      setRecipientSearched(false);
      setRecipientBusy(false);
      return;
    }
    const request = ++recipientRequest.current;
    const timer = window.setTimeout(() => {
      setRecipientBusy(true);
      shippingApi
        .recipientOptions(query)
        .then((result) => {
          if (request !== recipientRequest.current) return;
          setRecipientOptions(result.recipients);
          setRecipientSearched(true);
        })
        .catch((reason) => {
          if (request === recipientRequest.current) reportError(reason);
        })
        .finally(() => {
          if (request === recipientRequest.current) setRecipientBusy(false);
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [recipientSearch, view, reportError]);
  const activeProductCode =
    activeProductIndex === null
      ? ""
      : (draft.products[activeProductIndex]?.code ?? "").trim();
  useEffect(() => {
    if (
      view !== "editor" ||
      activeProductIndex === null ||
      activeProductCode.length < 2
    ) {
      productRequest.current += 1;
      setProductOptions([]);
      setProductSearched(false);
      setProductBusy(false);
      return;
    }
    const index = activeProductIndex;
    const code = activeProductCode;
    const request = ++productRequest.current;
    const timer = window.setTimeout(() => {
      setProductBusy(true);
      shippingApi
        .productOptions(code)
        .then((result) => {
          if (request !== productRequest.current) return;
          const exact = result.products.find(
            (product) => product.code.toLocaleLowerCase() === code.toLocaleLowerCase(),
          );
          if (exact) {
            setDraft((current) => ({
              ...current,
              products: current.products.map((item, itemIndex) =>
                itemIndex === index
                  ? {
                      ...item,
                      code: exact.code,
                      name: exact.name,
                      weight: exact.weight || item.weight,
                    }
                  : item,
              ),
            }));
            setProductOptions([]);
            setProductSearched(false);
            setActiveProductIndex(null);
            return;
          }
          setProductOptions(result.products);
          setProductSearched(true);
        })
        .catch((reason) => {
          if (request === productRequest.current) reportError(reason);
        })
        .finally(() => {
          if (request === productRequest.current) setProductBusy(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeProductCode, activeProductIndex, view, reportError]);
  useEffect(() => {
    if (activeProductIndex === null) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(`[data-shipping-product="${activeProductIndex}"]`)
      )
        return;
      setActiveProductIndex(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [activeProductIndex]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const editResult = (s: Shipment) => {
    const normalizedDraft = {
      ...emptyDraft(),
      ...s.draft,
      handling_note: s.draft.handling_note || emptyDraft().handling_note,
    };
    setShipment(s);
    setDraft(normalizedDraft);
    setBaseline(JSON.stringify(normalizedDraft));
    setOrderId(s.order_id);
    setOrderCode(s.order_code ?? "");
    setRates([]);
    setLabelLink("");
    resetRecipientLookup();
    resetProductLookup();
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
        resetRecipientLookup();
        draftId.current = crypto.randomUUID();
        setView("editor");
        if (r.previous.length) setNotice(c.duplicateOrder);
      })
      .catch(reportError)
      .finally(() => setBusy(false));
  }, [
    bootstrap,
    params,
    c.duplicateOrder,
    reportError,
    resetRecipientLookup,
    resetProductLookup,
  ]);
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
  async function deleteDraft(target: Shipment) {
    if (busy || deletingDraft.current || target.status !== "draft" || target.tracking_number) return;
    const unsaved = view === "editor" && shipment?.id === target.id && dirty;
    const confirmation = `${c.confirmDeleteDraft}\n\n${target.reference_no}${unsaved ? `\n\n${c.deleteUnsaved}` : ""}`;
    if (!window.confirm(confirmation)) return;
    deletingDraft.current = true;
    try {
      await run(async () => {
        await shippingApi.action("archive", target);
        // Only leave the editor after the versioned archive is accepted.
        // A conflict/failure above keeps all unsaved input available to staff.
        setShipment(null);
        setLabelOpen(false);
        setView("list");
        setParams({});
        setPage(0);
        setRows([]);
        setCount(0);
        setListLoading(true);
        setListRevision((revision) => revision + 1);
        setNotice(c.draftDeleted);
      });
    } finally {
      deletingDraft.current = false;
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
    resetRecipientLookup();
    resetProductLookup();
    setNotice("");
    setError("");
    draftId.current = crypto.randomUUID();
    setView("editor");
  }
  const change = <K extends keyof ShippingDraft>(
    key: K,
    value: ShippingDraft[K],
  ) => {
    const affectsRates = shippingQuoteKey(draft) !== shippingQuoteKey({ ...draft, [key]: value });
    setDraft((d) => ({ ...d, [key]: value, ...(affectsRates ? { carrier_code: "" } : {}) }));
    if (affectsRates) setRates([]);
  };
  const changeParcels = (parcels: ShippingParcel[]) => {
    const next = { ...draft, ...parcels[0], parcels, parcel_total: parcels.length };
    const affectsRates = shippingQuoteKey(draft) !== shippingQuoteKey(next);
    setDraft({ ...next, ...(affectsRates ? { carrier_code: "" } : {}) });
    if (affectsRates) setRates([]);
  };
  const changeDestination = (next: ShippingDraft["destination"]) => {
    const changedSearch = [
      [next.telephone1, draft.destination.telephone1],
      [next.fullname, draft.destination.fullname],
      [next.company, draft.destination.company],
      [next.address, draft.destination.address],
    ].find(([nextValue, previousValue]) => nextValue !== previousValue)?.[0];
    change("destination", next);
    if (changedSearch !== undefined) setRecipientSearch(changedSearch);
  };
  const selectRecipient = (option: ShippingRecipientOption) => {
    change("destination", { ...emptyAddress(), ...option.address });
    resetRecipientLookup();
    setNotice(c.recipientLoaded);
  };
  const changeProductCode = (index: number, code: string) => {
    productRequest.current += 1;
    setDraft((current) => ({
      ...current,
      products: current.products.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, code, name: "", weight: 0 }
          : item,
      ),
    }));
    setActiveProductIndex(index);
    setProductOptions([]);
    setProductSearched(false);
  };
  const selectProduct = (index: number, product: ShippingProductOption) => {
    setDraft((current) => ({
      ...current,
      products: current.products.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              code: product.code,
              name: product.name,
              weight: product.weight || item.weight,
            }
          : item,
      ),
    }));
    resetProductLookup();
  };
  const { issues, rateIssues, invalidDraft } = useMemo(() => {
    try {
      const parsed = parseDraft(draft);
      return { issues: readyIssues(parsed), rateIssues: quoteIssues(parsed), invalidDraft: false };
    } catch {
      return { issues: ["invalid_payload"], rateIssues: [] as QuoteIssue[], invalidDraft: true };
    }
  }, [draft]);
  const quoteBlockers = invalidDraft
    ? [c.quoteInvalid]
    : rateIssues.map((issue) => c.quoteIssues[issue]);
  const locked = !!shipment && shipment.status !== "draft";
  const trackingUrl =
    shipment?.tracking_number && shipment.draft.carrier_code
      ? shippingTrackingUrl(
          shipment.draft.carrier_code,
          shipment.tracking_number,
        )
      : null;
  const errorMessage =
    error === "carrier_unavailable"
      ? c.carrierUnavailable
      : error === "provider_rejected"
        ? c.providerRejected
    : error === "forbidden"
      ? c.noPermission
      : error === "shipping_not_installed"
        ? c.notInstalled
        : error === "conflict" || error === "client_outdated"
          ? c.conflict
          : error === "provider_not_ready"
            ? c.prepareOnly
            : error === "account_changed"
              ? c.accountChanged
              : error === "outcome_unknown"
                ? c.unknown
                : error === "quote_incomplete"
                  ? c.quoteMissing
                  : error.startsWith("invalid_") || error === "shipment_incomplete"
                    ? c.missing
                    : c.genericError;
  async function save() {
    const d = parseDraft(draft);
    const r = shipment
      ? await shippingApi.save(shipment, d)
      : await shippingApi.create(draftId.current, d, orderId);
    editResult(r.shipment);
    setRates(rates);
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
    resetRecipientLookup();
    resetProductLookup();
    if (r.previous.length) setNotice(c.duplicateOrder);
  }
  const status = (s: Shipment) => c.statuses[s.status];
  const selectClass =
    "h-10 w-full border border-input rounded-md bg-background px-3";
  const ShippingLabel = labelModule?.default;
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
            <strong>
              {bootstrap.sendReady
                ? c.ready
                : bootstrap.readReady
                  ? c.readsReady
                  : c.prepareOnly}
            </strong>
            <span className="ml-2 uppercase">
              {bootstrap.settings.environment}
            </span>
            <p className="mt-1 text-muted-foreground">
              {!bootstrap.readReady
                ? c.providerNote
                : bootstrap.settings.environment === "uat"
                  ? c.uatNote
                  : c.estimated}
            </p>
            {bootstrap.readReady && (
              <p className="mt-1 text-muted-foreground">{c.quoteGuide}</p>
            )}
          </div>
          {view === "settings" && bootstrap.manager && (
            <ShippingSettings
              bootstrap={bootstrap}
              onSaved={reload}
              onError={reportError}
            />
          )}
          {view === "list" && (
            <section className="space-y-3" aria-busy={listLoading}>
              <Input
                aria-label={c.search}
                placeholder={c.search}
                maxLength={80}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
              {listLoading && <p role="status" className="text-sm text-muted-foreground">{c.loading}</p>}
              {!rows.length ? (
                <p className="py-12 text-center text-muted-foreground">
                  {listLoading ? c.loading : c.empty}
                </p>
              ) : (
                <div className="grid gap-3">
                  {rows.map((s) => (
                    <ShipmentListCard key={s.id} shipment={s} busy={busy} onOpen={() =>
                      void run(async () => {
                        const r = await shippingApi.get(s.id);
                        editResult(r.shipment);
                        setEvents(r.events);
                        setView("editor");
                      })
                    } onDelete={() => void deleteDraft(s)} />
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
                  <h2 className="section-heading">
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
                          resetRecipientLookup();
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
                  <section className="rounded-xl border p-4 space-y-3">
                    <label className="block text-sm space-y-1">
                      {c.handlingNote}
                      <Input
                        value={draft.handling_note}
                        maxLength={120}
                        placeholder={c.handlingPlaceholder}
                        onChange={(e) =>
                          change("handling_note", e.target.value)
                        }
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[c.fragilePreset, c.throwPreset, c.stackPreset].map(
                        (note) => (
                          <Button
                            key={note}
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => change("handling_note", note)}
                          >
                            {note}
                          </Button>
                        ),
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {c.handlingHint}
                    </p>
                  </section>
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
                      onChange={changeDestination}
                      beforeFields={
                        <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                          <label className="block text-sm font-medium">
                            {c.recipientSearch}
                            <span className="relative mt-1 block">
                              <Input
                                value={recipientSearch}
                                autoComplete="off"
                                placeholder={c.recipientSearch}
                                onChange={(e) =>
                                  setRecipientSearch(e.target.value)
                                }
                                className="bg-white pr-10"
                              />
                              {recipientBusy && (
                                <Loader2
                                  aria-label={c.loading}
                                  size={16}
                                  className="absolute right-3 top-3 animate-spin text-blue-700"
                                />
                              )}
                            </span>
                          </label>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {c.recipientSearchHint}
                          </p>
                          {!!recipientOptions.length && (
                            <div
                              role="listbox"
                              className="mt-2 max-h-64 divide-y overflow-y-auto rounded-md border bg-white shadow-sm"
                            >
                              {recipientOptions.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  role="option"
                                  aria-selected="false"
                                  className="block w-full px-3 py-2 text-left hover:bg-blue-50 focus:bg-blue-50"
                                  onClick={() => selectRecipient(option)}
                                >
                                  <span className="flex items-center justify-between gap-2">
                                    <strong className="truncate text-sm">
                                      {option.address.company || option.address.fullname}
                                    </strong>
                                    <small className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                                      {option.source === "customer"
                                        ? c.recipientCustomer
                                        : c.recipientHistory}
                                    </small>
                                  </span>
                                  {!!option.address.company && !!option.address.fullname && (
                                    <span className="block text-xs">{c.fullname}: {option.address.fullname}</span>
                                  )}
                                  <span className="block text-xs text-muted-foreground">
                                    {option.address.telephone1 || "—"} ·{" "}
                                    {[
                                      option.address.county,
                                      option.address.city,
                                      option.address.state,
                                      option.address.postcode,
                                    ]
                                      .filter(Boolean)
                                      .join(" ") || option.address.address}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          {recipientSearched &&
                            !recipientBusy &&
                            !recipientOptions.length && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {c.recipientEmpty}
                              </p>
                            )}
                        </div>
                      }
                    />
                  </div>
                  <ShippingParcels draft={draft} onChange={changeParcels} />
                  {!locked && <ShippingRateComparison
                    rates={rates} selected={draft.carrier_code} parcelCount={draft.parcel_total}
                    blockers={quoteBlockers} readReady={bootstrap.readReady} busy={busy}
                    environment={bootstrap.settings.environment}
                    onCompare={() => void run(async () => {
                      const r = await shippingApi.compare(parseDraft(draft));
                      setRates(r.rates);
                      setNotice(r.rates.some((rate) => rate.available) ? c.quoteReceived : c.quoteEmpty);
                    })}
                    onSelect={(code) => change("carrier_code", code)}
                  />}
                  <section className="rounded-xl border p-4 space-y-3">
                    <h2 className="section-heading">3. {c.items}</h2>
                    <p className="text-sm text-muted-foreground">{draft.products.length} {c.itemRows} · {summarizeShippingItems(draft.products).totalQuantity} {c.pieceUnit}</p>
                    {draft.products.map((item, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-2 items-end gap-2 border-b pb-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_100px_150px_auto]"
                      >
                        <label
                          data-shipping-product={index}
                          className="relative col-span-2 space-y-1 text-sm lg:col-span-1"
                        >
                          <span>{c.code}</span>
                          <Input
                            aria-label={`${c.code} ${index + 1}`}
                            autoComplete="off"
                            value={item.code}
                            maxLength={100}
                            placeholder={c.productSearchHint}
                            onFocus={() => {
                              if (item.code.trim().length >= 2)
                                setActiveProductIndex(index);
                            }}
                            onChange={(event) =>
                              changeProductCode(index, event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                resetProductLookup();
                                return;
                              }
                              if (event.key === "Enter" && productOptions[0]) {
                                event.preventDefault();
                                selectProduct(index, productOptions[0]);
                              }
                            }}
                          />
                          {activeProductIndex === index &&
                            item.code.trim().length >= 2 && (
                              <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border bg-white shadow-xl">
                                {productBusy && (
                                  <p className="px-3 py-2 text-xs text-muted-foreground">
                                    {c.productSearching}
                                  </p>
                                )}
                                {!productBusy &&
                                  productOptions.map((product) => (
                                    <button
                                      key={product.id}
                                      type="button"
                                      className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted focus:bg-muted focus:outline-none"
                                      onMouseDown={(event) =>
                                        event.preventDefault()
                                      }
                                      onClick={() =>
                                        selectProduct(index, product)
                                      }
                                    >
                                      <strong className="block text-sm">
                                        {product.code}
                                      </strong>
                                      <span className="block text-xs text-muted-foreground">
                                        {product.name}
                                      </span>
                                    </button>
                                  ))}
                                {!productBusy &&
                                  productSearched &&
                                  !productOptions.length && (
                                    <p className="px-3 py-2 text-xs text-muted-foreground">
                                      {c.productEmpty}
                                    </p>
                                  )}
                              </div>
                            )}
                        </label>
                        <label className="col-span-2 space-y-1 text-sm lg:col-span-1">
                          <span>{c.itemName}</span>
                          <Input
                            aria-label={`${c.itemName} ${index + 1}`}
                            value={item.name}
                            maxLength={100}
                            onChange={(event) =>
                              change(
                                "products",
                                draft.products.map((value, itemIndex) =>
                                  itemIndex === index
                                    ? { ...value, name: event.target.value }
                                    : value,
                                ),
                              )
                            }
                          />
                        </label>
                        {(["qty", "weight"] as const).map((key) => (
                          <label key={key} className="space-y-1 text-sm">
                            <span>{c[key]}</span>
                            <Input
                              aria-label={`${c[key]} ${index + 1}`}
                              value={item[key]}
                              type="number"
                              min="0"
                              step="1"
                              onChange={(event) =>
                                change(
                                  "products",
                                  draft.products.map((value, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...value,
                                          [key]: Number(event.target.value),
                                        }
                                      : value,
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
                          onClick={() => {
                            resetProductLookup();
                            change(
                              "products",
                              draft.products.filter((_, i) => i !== index),
                            );
                          }}
                        >
                          {c.remove}
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={draft.products.length >= 5}
                      onClick={() => {
                        resetProductLookup();
                        change("products", [
                          ...draft.products,
                          {
                            name: "",
                            code: "",
                            qty: 1,
                            price: "0.00",
                            weight: 0,
                          },
                        ]);
                      }}
                    >
                      {c.addItem}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {c.itemLimit}
                    </p>
                  </section>
                  <section className="rounded-xl border p-4 space-y-3">
                    <h2 className="section-heading">{c.cod}</h2>
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
              {shipment && !locked && <p className="text-sm text-muted-foreground">{c.draftTrackingNote}</p>}
              {shipment && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy || dirty}
                    onClick={() => {
                      setLabelOpen(true);
                      if (!labelModule) void loadShippingLabel().then(setLabelModule).catch((reason) => {
                        setLabelOpen(false);
                        reportError(reason);
                      });
                    }}
                  >
                    <Printer size={16} />
                    {c.labelPreview}
                  </Button>
                  {shipment.status === "draft" && (
                    <>
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
                      {!shipment.tracking_number && <Button
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => void deleteDraft(shipment)}
                      >
                        <Trash2 size={16} />{c.deleteDraft}
                      </Button>}
                    </>
                  )}
                  {shipment.tracking_number && (
                    <>
                      {trackingUrl && (
                        <>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await copyText(trackingUrl);
                                setNotice(c.trackingCopied);
                              })
                            }
                          >
                            <Copy size={16} />
                            {c.copyTrackingLink}
                          </Button>
                          <Button asChild variant="outline">
                            <a
                              href={trackingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink size={16} />
                              {c.openTracking}
                            </a>
                          </Button>
                        </>
                      )}
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
                        {c.carrierPrint}
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
                  {c.carrierPrint} ↗
                </a>
              )}
              {!!events.length && (
                <section className="border rounded-xl p-4">
                  <h2 className="section-heading">{c.history}</h2>
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
      {labelOpen && shipment && bootstrap && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-black/70 p-2 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={c.labelPreview}
        >
          <div className="mx-auto mb-3 flex w-full max-w-[100mm] items-center justify-between gap-2 rounded-lg bg-white p-2 shadow-lg">
            <strong className="text-sm">
              {c.labelPreview} · 100 × 150 mm ·{" "}
              {shipment.draft.parcel_total || 1}{" "}
              {language === "th" ? "ใบ" : "labels"}
            </strong>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!labelModule}
                onClick={() =>
                  labelModule && printElement(labelModule.SHIPPING_LABEL_ID, {
                    title: `${c.labelPreview} ${shipment.tracking_number || shipment.reference_no}`,
                    pageSize: "label-100x150",
                  })
                }
              >
                <Printer size={15} />
                {c.printLabel}
              </Button>
              <Button
                size="icon"
                variant="outline"
                aria-label={c.close}
                onClick={() => setLabelOpen(false)}
              >
                <X size={16} />
              </Button>
            </div>
          </div>
          <div className="mx-auto min-h-0 max-w-full flex-1 overflow-auto bg-neutral-200 p-1 shadow-2xl">
            {ShippingLabel ? <ShippingLabel
              shipment={shipment}
              companyName={bootstrap.brand.name}
            /> : <p role="status" className="p-4 text-sm">{c.loading}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
