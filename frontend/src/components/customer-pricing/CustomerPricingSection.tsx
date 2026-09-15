import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthProvider';
import { CK, hasCache, invalidateList, swrList } from '@/lib/cache';
import { isAdminOrOwner } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n';
import { customerPricingCopy } from '@/lib/customer-pricing-copy';
import {
  getEffectivePrice,
  tierApi,
  type CustomerBenefit,
} from '@/lib/api';
import {
  customerPricingApi,
  type CustomerNetPriceRule,
  type CustomerPricingProduct,
  type ResolvedCustomerPrice,
} from '@/lib/customer-pricing-api';
import type { Customer } from '@/lib/database.types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PricingBundle {
  rules: CustomerNetPriceRule[];
  tier: CustomerBenefit | null;
  resolved: ResolvedCustomerPrice[];
}

interface PricingPreviewItem {
  product_id: string;
  unit: string;
  quantity: number;
}

interface EditorState {
  ruleId: string | null;
  product: CustomerPricingProduct | null;
  netPrice: string;
  validFrom: string;
  validUntil: string;
  note: string;
}

type RuleStatus = 'active' | 'scheduled' | 'expired';

const PRICE_RESOLUTION_BATCH_SIZE = 100;
const PRICE_RESOLUTION_CONCURRENCY = 3;

const money = (value: unknown) => new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value) || 0);

function toLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDateTime(iso: string | null | undefined, language: 'th' | 'en'): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function ruleStatus(rule: CustomerNetPriceRule, now = Date.now()): RuleStatus {
  if (!rule.active) return 'expired';
  const starts = new Date(rule.valid_from).getTime();
  const ends = rule.valid_until ? new Date(rule.valid_until).getTime() : null;
  if (Number.isFinite(starts) && starts > now) return 'scheduled';
  if (ends != null && Number.isFinite(ends) && ends <= now) return 'expired';
  return 'active';
}

function resolvedKey(productId: string, unit: string): string {
  return `${productId}:${unit.trim().toLocaleLowerCase()}`;
}

async function resolvePriceBatches(
  customerId: string,
  items: PricingPreviewItem[],
): Promise<ResolvedCustomerPrice[]> {
  const batches: PricingPreviewItem[][] = [];
  for (let start = 0; start < items.length; start += PRICE_RESOLUTION_BATCH_SIZE) {
    batches.push(items.slice(start, start + PRICE_RESOLUTION_BATCH_SIZE));
  }

  const results = new Array<ResolvedCustomerPrice[]>(batches.length);
  let nextBatchIndex = 0;
  const resolveNextBatch = async () => {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      results[batchIndex] = await customerPricingApi.resolvePrices(customerId, batches[batchIndex]);
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(PRICE_RESOLUTION_CONCURRENCY, batches.length) },
    () => resolveNextBatch(),
  ));
  return results.flat();
}

async function fetchPricing(customerId: string): Promise<PricingBundle> {
  const [rules, tier] = await Promise.all([
    customerPricingApi.listRules(customerId),
    tierApi.customerBenefit(customerId),
  ]);
  const distinctItems = [...new Map(rules.map((rule) => [
    resolvedKey(rule.product_id, rule.unit),
    {
      product_id: rule.product_id,
      unit: rule.unit,
      quantity: Math.max(1, Math.floor(Number(rule.min_order_qty) || 1)),
    },
  ])).values()];
  const resolved = await resolvePriceBatches(customerId, distinctItems);
  return { rules, tier, resolved };
}

function newEditor(product: CustomerPricingProduct | null = null): EditorState {
  return {
    ruleId: null,
    product,
    netPrice: '',
    validFrom: toLocalDateTime(new Date().toISOString()),
    validUntil: '',
    note: '',
  };
}

function apiErrorMessage(error: unknown, duplicate: string, fallback: string): string {
  const candidate = error as { code?: string; message?: string } | null;
  if (candidate?.code === '23505' || candidate?.message?.toLowerCase().includes('overlap')) {
    return duplicate;
  }
  return candidate?.message ? `${fallback}: ${candidate.message}` : fallback;
}

export default function CustomerPricingSection({
  customer,
}: {
  customer: Pick<Customer, 'id' | 'name' | 'code' | 'tier'>;
}) {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const words = customerPricingCopy[language];
  const canManage = isAdminOrOwner(profile?.role);
  const cacheKey = CK.customerPricing(customer.id);
  const requestVersion = useRef(0);
  const searchVersion = useRef(0);
  const [bundle, setBundle] = useState<PricingBundle | null>(null);
  const [loading, setLoading] = useState(!hasCache(cacheKey));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<CustomerPricingProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expireConfirmId, setExpireConfirmId] = useState<string | null>(null);
  const [expiringId, setExpiringId] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    const version = ++requestVersion.current;
    setError(null);
    if (force) setRefreshing(true);
    else if (!hasCache(cacheKey)) setLoading(true);
    try {
      const result = await swrList(cacheKey, () => fetchPricing(customer.id), {
        force,
        onFresh: (fresh) => {
          if (requestVersion.current === version) setBundle(fresh);
        },
        onBackgroundError: (backgroundError) => {
          if (requestVersion.current === version) {
            setError(apiErrorMessage(backgroundError, words.duplicate, words.loadFailed));
          }
        },
      });
      if (requestVersion.current === version) setBundle(result);
    } catch (loadError) {
      if (requestVersion.current === version) {
        setError(apiErrorMessage(loadError, words.duplicate, words.loadFailed));
      }
    } finally {
      if (requestVersion.current === version) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [cacheKey, customer.id, setBundle, words.duplicate, words.loadFailed]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
      searchVersion.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!editor || editor.ruleId || productQuery.trim().length < 2) {
      searchVersion.current += 1;
      setProductResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const version = ++searchVersion.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void customerPricingApi.searchProducts(productQuery)
        .then((rows) => {
          if (searchVersion.current === version) setProductResults(rows);
        })
        .catch((searchFailure: unknown) => {
          if (searchVersion.current === version) {
            setProductResults([]);
            setSearchError(apiErrorMessage(searchFailure, words.duplicate, words.loadFailed));
          }
        })
        .finally(() => {
          if (searchVersion.current === version) setSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [editor, productQuery, words.duplicate, words.loadFailed]);

  const resolvedByProduct = useMemo(() => new Map(
    (bundle?.resolved ?? []).map((row) => [resolvedKey(row.product_id, row.unit), row]),
  ), [bundle?.resolved]);

  const visibleRules = useMemo(() => {
    const rows = bundle?.rules ?? [];
    // Keep temporally expired-but-active rows visible: the database's active
    // uniqueness slot must be released before a replacement can be created.
    return showExpired ? rows : rows.filter((rule) => rule.active);
  }, [bundle?.rules, showExpired]);

  const activeCount = useMemo(
    () => (bundle?.rules ?? []).filter((rule) => ruleStatus(rule) === 'active').length,
    [bundle?.rules],
  );

  const tierPercent = Number(bundle?.tier?.discount_percent ?? 0);

  function startEdit(rule: CustomerNetPriceRule) {
    const resolved = resolvedByProduct.get(resolvedKey(rule.product_id, rule.unit));
    setEditor({
      ruleId: rule.id,
      product: {
        id: rule.product_id,
        sku: rule.sku,
        name_th: rule.product_name,
        name_en: null,
        unit: rule.unit,
        min_order_qty: rule.min_order_qty,
        price: Number(resolved?.list_price ?? rule.net_price),
        discount_type: resolved?.normal_discount_type ?? 'fixed',
        discount_value: Number(resolved?.normal_discount_value ?? 0),
        updated_at: rule.updated_at,
      },
      netPrice: String(rule.net_price),
      validFrom: toLocalDateTime(rule.valid_from),
      validUntil: toLocalDateTime(rule.valid_until),
      note: rule.note ?? '',
    });
    setProductQuery('');
    setProductResults([]);
    setError(null);
    setMessage(null);
  }

  async function saveRule() {
    if (!editor?.product) {
      setError(words.invalidProduct);
      return;
    }
    const netPrice = Number(editor.netPrice);
    if (!Number.isFinite(netPrice) || netPrice <= 0) {
      setError(words.invalidPrice);
      return;
    }
    const validFrom = toIso(editor.validFrom);
    const validUntil = toIso(editor.validUntil);
    if (!validFrom || (validUntil && new Date(validUntil).getTime() <= new Date(validFrom).getTime())) {
      setError(words.invalidDates);
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (editor.ruleId) {
        await customerPricingApi.updateRule(customer.id, editor.ruleId, {
          net_price: netPrice,
          active: true,
          valid_from: validFrom,
          valid_until: validUntil,
          note: editor.note.trim() || null,
        });
      } else {
        await customerPricingApi.createRule({
          customer_id: customer.id,
          product_id: editor.product.id,
          unit: editor.product.unit,
          net_price: netPrice,
          active: true,
          valid_from: validFrom,
          valid_until: validUntil,
          note: editor.note.trim() || null,
        });
      }
      setEditor(null);
      setProductQuery('');
      invalidateList(cacheKey);
      await load(true);
      setMessage(words.saved);
    } catch (saveError) {
      setError(apiErrorMessage(saveError, words.duplicate, words.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  async function expireRule(ruleId: string) {
    setExpiringId(ruleId);
    setError(null);
    setMessage(null);
    try {
      await customerPricingApi.expireRule(customer.id, ruleId);
      setExpireConfirmId(null);
      invalidateList(cacheKey);
      await load(true);
      setMessage(words.expiredSaved);
    } catch (expireError) {
      setError(apiErrorMessage(expireError, words.duplicate, words.saveFailed));
    } finally {
      setExpiringId(null);
    }
  }

  function sourceLabel(source: string): string {
    if (source === 'customer_net') return words.priceNet;
    if (source === 'tier') return words.priceTier;
    if (source === 'base') return words.priceBase;
    return words.priceCalculated;
  }

  return (
    <div data-customer-pricing="on-demand" className="space-y-3 pb-6">
      <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900">
        <div className="flex items-start gap-2">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-sky-600" />
          <div>
            <div className="font-bold">{words.priority}</div>
            {!canManage && <div className="mt-1 text-sky-700">{words.readOnly}</div>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-[10px] text-neutral-500">{words.tier}</div>
          <div className="mt-0.5 font-bold text-neutral-900">{bundle?.tier?.tier_label ?? customer.tier}</div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-[10px] text-neutral-500">{words.tierDiscount}</div>
          <div className="mt-0.5 font-bold tabular-nums text-emerald-700">{tierPercent}%</div>
        </div>
        <div className="col-span-2 rounded-lg border border-neutral-200 bg-white p-3 sm:col-span-1">
          <div className="text-[10px] text-neutral-500">{words.activeRules}</div>
          <div className="mt-0.5 font-bold tabular-nums text-sky-700">{activeCount}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-neutral-900">{words.title}</h3>
          <p className="text-[11px] text-neutral-500">{customer.name}{customer.code ? ` · ${customer.code}` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="h-9 gap-1.5"
            aria-label={words.reload}
            title={words.reload}
          >
            <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
            <span className="hidden sm:inline">{words.reload}</span>
          </Button>
          {canManage && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditor(newEditor());
                setError(null);
                setMessage(null);
              }}
              className="h-9 gap-1.5 bg-sky-700 hover:bg-sky-800"
            >
              <Plus size={14} /> {words.add}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
          <Check size={14} /> {message}
        </div>
      )}

      {editor && canManage && (
        <div className="rounded-xl border border-sky-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-neutral-900">
              <Tag size={15} className="text-sky-600" />
              {editor.ruleId ? words.edit : words.add}
            </div>
            <button type="button" onClick={() => setEditor(null)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label={words.cancel}>
              <X size={17} />
            </button>
          </div>

          {!editor.ruleId && !editor.product && (
            <div className="space-y-1.5">
              <Label htmlFor="customer-price-product-search">{words.product}</Label>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <Input
                  id="customer-price-product-search"
                  autoFocus
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                  placeholder={words.searchProduct}
                  className="h-10 pl-9"
                />
              </div>
              <p className="text-[10px] text-neutral-400">{words.searchHint}</p>
              {searching && <div className="py-3 text-center text-xs text-neutral-500"><Loader2 size={14} className="mr-1.5 inline animate-spin" />{words.searching}</div>}
              {searchError && <div className="text-xs text-red-600">{searchError}</div>}
              {!searching && productQuery.trim().length >= 2 && !searchError && productResults.length === 0 && (
                <div className="py-3 text-center text-xs text-neutral-400">{words.noProducts}</div>
              )}
              {productResults.length > 0 && (
                <div className="max-h-60 divide-y divide-neutral-100 overflow-y-auto rounded-lg border border-neutral-200">
                  {productResults.map((product) => {
                    const base = getEffectivePrice(product);
                    const tierPrice = Math.round(base * (1 - tierPercent / 100) * 100) / 100;
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => {
                          setEditor((current) => current ? { ...current, product } : current);
                          setProductQuery('');
                          setProductResults([]);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-sky-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-neutral-800">{product.name_th}</span>
                          <span className="block font-mono text-[10px] text-neutral-500">{product.sku} · {product.unit}</span>
                        </span>
                        <span className="text-right text-[10px] text-neutral-500">
                          <span className="block">{words.basePrice} {money(base)}</span>
                          <span className="block font-bold text-emerald-700">{words.tierPrice} {money(tierPrice)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {editor.product && (
            <div className="space-y-3">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <div className="text-sm font-bold text-neutral-900">{editor.product.name_th}</div>
                <div className="mt-0.5 font-mono text-[10px] text-neutral-500">{editor.product.sku}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  <div><span className="block text-neutral-400">{words.cataloguePrice}</span><b className="tabular-nums">{money(editor.product.price)}</b></div>
                  <div><span className="block text-neutral-400">{words.basePrice}</span><b className="tabular-nums">{money(getEffectivePrice(editor.product))}</b></div>
                  <div><span className="block text-neutral-400">{words.tierPrice}</span><b className="tabular-nums text-emerald-700">{money(Math.round(getEffectivePrice(editor.product) * (1 - tierPercent / 100) * 100) / 100)}</b></div>
                  <div><span className="block text-neutral-400">{words.unit}</span><b>{editor.product.unit || '—'}</b></div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="customer-net-price">{words.netPrice} *</Label>
                  <div className="relative">
                    <Input
                      id="customer-net-price"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      value={editor.netPrice}
                      onChange={(event) => setEditor((current) => current ? { ...current, netPrice: event.target.value } : current)}
                      className="h-10 pr-16 text-right tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400">{words.currency}/{editor.product.unit || words.unit}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customer-price-valid-from">{words.validFrom} *</Label>
                  <Input
                    id="customer-price-valid-from"
                    type="datetime-local"
                    value={editor.validFrom}
                    onChange={(event) => setEditor((current) => current ? { ...current, validFrom: event.target.value } : current)}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="customer-price-valid-until">{words.validUntil}</Label>
                  <Input
                    id="customer-price-valid-until"
                    type="datetime-local"
                    value={editor.validUntil}
                    onChange={(event) => setEditor((current) => current ? { ...current, validUntil: event.target.value } : current)}
                    className="h-10"
                  />
                  <p className="text-[10px] text-neutral-400">{words.noExpiry}</p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="customer-price-note">{words.note}</Label>
                  <textarea
                    id="customer-price-note"
                    rows={2}
                    maxLength={500}
                    value={editor.note}
                    onChange={(event) => setEditor((current) => current ? { ...current, note: event.target.value } : current)}
                    placeholder={words.notePlaceholder}
                    className="w-full resize-y rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setEditor(null)} disabled={saving} className="h-10">
                  {words.cancel}
                </Button>
                <Button type="button" onClick={() => void saveRule()} disabled={saving} className="h-10 gap-1.5 bg-sky-700 hover:bg-sky-800">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {saving ? words.saving : words.save}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-700">
            <Percent size={14} className="text-sky-600" /> {words.activeRules}
          </div>
          <button
            type="button"
            onClick={() => setShowExpired((value) => !value)}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-neutral-600 hover:bg-white"
          >
            {showExpired ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showExpired ? words.hideExpired : words.showExpired}
          </button>
        </div>

        {loading && (
          <div className="p-10 text-center text-sm text-neutral-500">
            <Loader2 size={17} className="mr-2 inline animate-spin" /> {words.loading}
          </div>
        )}
        {!loading && visibleRules.length === 0 && (
          <div className="p-10 text-center text-sm text-neutral-400">{words.empty}</div>
        )}

        {!loading && visibleRules.length > 0 && (
          <div className="divide-y divide-neutral-100">
            {visibleRules.map((rule) => {
              const status = ruleStatus(rule);
              const resolved = resolvedByProduct.get(resolvedKey(rule.product_id, rule.unit));
              const statusLabel = status === 'active'
                ? words.statusActive
                : status === 'scheduled'
                  ? words.statusScheduled
                  : rule.active
                    ? words.statusExpiredActive
                    : words.statusExpired;
              const statusClass = status === 'active'
                ? 'bg-emerald-100 text-emerald-700'
                : status === 'scheduled'
                  ? 'bg-amber-100 text-amber-700'
                  : rule.active
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-neutral-100 text-neutral-500';
              return (
                <article key={rule.id} className="p-3 sm:p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold text-neutral-900">{rule.product_name}</h4>
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', statusClass)}>{statusLabel}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-neutral-500">{rule.sku} · {rule.unit}</div>
                      {rule.note && <p className="mt-1.5 whitespace-pre-wrap text-xs text-neutral-600">{rule.note}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[410px]">
                      <div className="rounded-lg bg-neutral-50 p-2">
                        <div className="text-[10px] text-neutral-400">{words.basePrice}</div>
                        <div className="mt-0.5 text-xs font-bold tabular-nums text-neutral-700">{resolved ? money(resolved.base_price) : '—'}</div>
                      </div>
                      <div className="rounded-lg bg-emerald-50 p-2">
                        <div className="text-[10px] text-emerald-600">{words.tierPrice}</div>
                        <div className="mt-0.5 text-xs font-bold tabular-nums text-emerald-700">
                          {resolved ? money(Math.round(resolved.base_price * (1 - resolved.tier_percent / 100) * 100) / 100) : '—'}
                        </div>
                      </div>
                      <div className="rounded-lg bg-sky-50 p-2">
                        <div className="text-[10px] text-sky-600">{words.netPrice}</div>
                        <div className="mt-0.5 text-sm font-extrabold tabular-nums text-sky-800">{money(rule.net_price)}</div>
                      </div>
                      <div className="rounded-lg border border-sky-100 bg-white p-2">
                        <div className="text-[10px] text-neutral-400">{words.effectivePrice}</div>
                        <div className="mt-0.5 text-xs font-bold tabular-nums text-neutral-900">{resolved ? money(resolved.final_price) : '—'}</div>
                        {resolved && <div className="mt-0.5 text-[9px] font-semibold text-sky-700">{sourceLabel(resolved.price_source)}</div>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 border-t border-neutral-100 pt-2 text-[10px] text-neutral-500 sm:flex-row sm:items-center">
                    <span className="inline-flex items-center gap-1"><CalendarClock size={11} /> {words.validFrom}: {formatDateTime(rule.valid_from, language)}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 size={11} /> {words.validUntil}: {rule.valid_until ? formatDateTime(rule.valid_until, language) : words.noExpiry}</span>
                    <span className="inline-flex items-center gap-1 sm:ml-auto">{words.updated}: {formatDateTime(rule.updated_at, language)}</span>
                  </div>

                  {canManage && rule.active && (
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      {expireConfirmId === rule.id ? (
                        <div className="flex w-full flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 sm:w-auto sm:flex-row sm:items-center">
                          <span className="flex-1 text-[11px] text-amber-800">{words.expireQuestion}</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => setExpireConfirmId(null)} disabled={expiringId === rule.id} className="h-8 bg-white">
                            {words.cancel}
                          </Button>
                          <Button type="button" size="sm" onClick={() => void expireRule(rule.id)} disabled={expiringId === rule.id} className="h-8 gap-1 bg-amber-600 hover:bg-amber-700">
                            {expiringId === rule.id && <Loader2 size={12} className="animate-spin" />}{words.expireConfirm}
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button type="button" variant="outline" size="sm" onClick={() => startEdit(rule)} className="h-8 gap-1">
                            <Pencil size={12} /> {words.edit}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => setExpireConfirmId(rule.id)} className="h-8 text-amber-700 hover:bg-amber-50 hover:text-amber-800">
                            {words.expire}
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
