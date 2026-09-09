import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import {
  parseDraft,
  parseDraftUpdate,
  emptyDraft,
  emptyAddress,
  normalizeShippingContact,
  recipientAddress,
  shipmentWithContactFields,
  isUuid,
  canUseShipping,
  readyIssues,
  shipmentSearchFilter,
  providerPayload,
  moneyMinor,
  acceptStatus,
  type Shipment,
  type ShippingAddress,
} from "../_shared/shipping-domain.ts";
import {
  assertProviderReady,
  requestProvider,
  type ProviderConfig,
} from "../_shared/promptspeed.ts";
import { compareShippingRates } from "../_shared/shipping-rates.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
const fail = (code: string, status = 400) => reply({ error: code }, status);
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const small = (v: unknown, max = 100) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const recipientHaystack = (address: ShippingAddress) =>
  Object.values(address).join(" ").toLocaleLowerCase("th");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return fail("unauthorized", 401);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    const { data: auth, error: authErr } = await db.auth.getUser(token);
    if (authErr || !auth.user) return fail("unauthorized", 401);
    const userId = auth.user.id;
    const [
      { data: profile, error: profileErr },
      { data: grant, error: grantErr },
    ] = await Promise.all([
      db
        .from("profiles")
        .select("role,is_active")
        .eq("id", userId)
        .maybeSingle(),
      db
        .from("shipping_permissions")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (profileErr || grantErr) return fail("shipping_not_installed", 503);
    if (!canUseShipping(profile, !!grant)) return fail("forbidden", 403);
    const manager = ["owner", "admin"].includes(profile!.role);
    const raw = await req.text();
    if (raw.length > 150000) return fail("payload_too_large", 413);
    let b: Record<string, unknown>;
    try {
      b = record(JSON.parse(raw));
    } catch {
      return fail("invalid_payload");
    }
    const action = small(b.action);
    const { data: settings, error: settingsErr } = await db
      .from("shipping_settings")
      .select("*")
      .eq("id", true)
      .single();
    if (settingsErr) return fail("shipping_not_installed", 503);
    const config: ProviderConfig = {
      environment: settings.environment,
      appId:
        Deno.env.get(
          `PROMPTSPEED_${settings.environment.toUpperCase()}_APP_ID`,
        ) ?? "",
      secret:
        Deno.env.get(
          `PROMPTSPEED_${settings.environment.toUpperCase()}_SECRET`,
        ) ?? "",
      specConfirmed: Deno.env.get("PROMPTSPEED_SPEC_CONFIRMED") === "true",
      readsEnabled: Deno.env.get("PROMPTSPEED_READS_ENABLED") === "true",
      mutationsEnabled:
        Deno.env.get("PROMPTSPEED_MUTATIONS_ENABLED") === "true",
    };
    if (action === "bootstrap") {
      const [accountResult, orgResult] = await Promise.all([
        db
          .from("shipping_cod_accounts")
          .select(manager ? "*" : "id,label")
          .eq("environment", settings.environment)
          .eq("merchant_code", settings.merchant_code)
          .eq("active", true),
        db
          .from("org_settings")
          .select("business_name,logo_url")
          .eq("id", true)
          .maybeSingle(),
      ]);
      if (accountResult.error || orgResult.error)
        throw accountResult.error ?? orgResult.error;
      const logo = small(orgResult.data?.logo_url, 500);
      let logoUrl: string | null = null;
      if (logo) {
        try {
          const parsed = new URL(logo);
          if (
            parsed.protocol === "https:" &&
            !parsed.username &&
            !parsed.password
          )
            logoUrl = parsed.toString();
        } catch {
          /* Text fallback is always available. */
        }
      }
      let readReady = false,
        sendReady = false;
      try {
        assertProviderReady(config, false);
        readReady = true;
        assertProviderReady(config, true);
        sendReady =
          !!settings.merchant_code && settings.billing_mode !== "unconfirmed";
      } catch {
        /* Default off. */
      }
      return reply({
        manager,
        brand: {
          name:
            small(orgResult.data?.business_name, 150) ||
            "J NAC (THAILAND) CO., LTD.",
          logo_url: logoUrl,
        },
        settings: {
          environment: settings.environment,
          billing_mode: settings.billing_mode,
          merchant_code: settings.merchant_code,
          origin: normalizeShippingContact({ ...emptyAddress(), ...settings.origin }),
        },
        accounts: accountResult.data,
        readReady,
        sendReady,
      });
    }
    if (action === "compare_rates") {
      assertProviderReady(config, false);
      return reply(await compareShippingRates(config, parseDraft(b.draft)));
    }
    if (action === "list") {
      const page = Math.max(
        0,
        Math.min(10000, Number.isInteger(b.page) ? Number(b.page) : 0),
      );
      let query = db
        .from("shipments")
        .select("*,orders(customers(name))", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * 25, page * 25 + 24);
      const searchFilter = shipmentSearchFilter(small(b.search, 80));
      if (searchFilter) query = query.or(searchFilter);
      const { data, error, count } = await query;
      if (error) throw error;
      return reply({
        shipments: (data ?? []).map(({ orders, ...shipment }) => ({
          ...shipmentWithContactFields(shipment as Shipment),
          recipient_company: small(record(record(orders).customers).name, 150),
        })),
        count,
      });
    }
    if (action === "order_options") {
      const search = small(b.search, 60).replace(/[%_\\]/g, "");
      const { data, error } = await db
        .from("orders")
        .select("id,code")
        .not("status", "in", "(cancelled,returned)")
        .ilike("code", `%${search}%`)
        .order("created_at", { ascending: false })
        .order("id")
        .limit(30);
      if (error) throw error;
      return reply({ orders: data });
    }
    if (action === "recipient_options") {
      const search = small(b.search, 80).toLocaleLowerCase("th");
      if (search.length < 3) return reply({ recipients: [] });
      const tokens = search.split(/\s+/).filter(Boolean);
      const [historyResult, customerResult] = await Promise.all([
        db
          .from("shipments")
          .select("id,draft,created_at")
          .order("created_at", { ascending: false })
          .order("id")
          .limit(200),
        db
          .from("customers")
          .select(
            "id,name,contact_name,customer_type,email,phone,mobile,shipping_address,created_at",
          )
          .order("created_at", { ascending: false })
          .order("id")
          .limit(500),
      ]);
      if (historyResult.error || customerResult.error)
        throw historyResult.error ?? customerResult.error;
      const recipients: {
        id: string;
        source: "history" | "customer";
        address: ShippingAddress;
      }[] = [];
      const seen = new Set<string>();
      const add = (
        id: string,
        source: "history" | "customer",
        address: ShippingAddress,
      ) => {
        if ((!address.fullname && !address.company) || (!address.address && !address.telephone1)) return;
        if (tokens.some((token) => !recipientHaystack(address).includes(token)))
          return;
        const key = [
          address.company,
          address.fullname,
          address.telephone1,
          address.address,
          address.postcode,
        ]
          .join("|")
          .toLocaleLowerCase("th");
        if (seen.has(key) || recipients.length >= 30) return;
        seen.add(key);
        recipients.push({ id, source, address });
      };
      for (const row of historyResult.data ?? []) {
        const draft = record(row.draft);
        add(`history:${row.id}`, "history", recipientAddress(draft.destination));
      }
      for (const row of customerResult.data ?? []) {
        add(
          `customer:${row.id}`,
          "customer",
          recipientAddress(row.shipping_address, {
            company: row.customer_type === "individual" ? "" : row.name,
            fullname: row.contact_name || (row.customer_type === "individual" ? row.name : ""),
            email: row.email,
            phone: row.phone ?? row.mobile,
          }),
        );
      }
      return reply({ recipients });
    }
    if (action === "product_options") {
      const search = small(b.search, 80).replace(/[%_\\]/g, "");
      if (search.length < 2) return reply({ products: [] });
      const { data, error } = await db
        .from("products")
        .select("id,sku,name_th,weight_kg")
        .eq("status", "active")
        .ilike("sku", `%${search}%`)
        .order("sku")
        .limit(20);
      if (error) throw error;
      return reply({
        products: (data ?? []).map((product) => ({
          id: product.id,
          code: product.sku,
          name: product.name_th,
          weight: Math.max(
            0,
            Math.round(Number(product.weight_kg ?? 0) * 1000),
          ),
        })),
      });
    }
    if (action === "order_draft") {
      if (!isUuid(b.order_id)) return fail("invalid_order");
      const { data: order, error } = await db
        .from("orders")
        .select("id,code,customer_id,shipping_address,status")
        .eq("id", b.order_id)
        .single();
      if (error || !order || ["cancelled", "returned"].includes(order.status))
        return fail("invalid_order");
      const [
        { data: items, error: itemErr },
        { data: customer, error: customerErr },
      ] = await Promise.all([
        db
          .from("order_items")
          .select("product_name,sku,quantity,unit_price,products(weight_kg)")
          .eq("order_id", order.id)
          .order("created_at")
          .limit(101),
        order.customer_id
          ? db
              .from("customers")
              .select(
                "name,contact_name,customer_type,email,phone,mobile,shipping_address",
              )
              .eq("id", order.customer_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (itemErr || customerErr) throw itemErr ?? customerErr;
      if (!items?.length || items.length > 100) return fail("invalid_items");
      const draft = emptyDraft();
      draft.purpose = order.code;
      draft.destination = recipientAddress(
        order.shipping_address ?? customer?.shipping_address,
        {
          company: customer?.customer_type === "individual" ? "" : customer?.name,
          fullname: customer?.contact_name || (customer?.customer_type === "individual" ? customer?.name : ""),
          email: customer?.email,
          phone: customer?.phone ?? customer?.mobile,
        },
      );
      draft.products = items.map((i) => ({
        name: i.product_name,
        code: i.sku ?? "",
        qty: Number(i.quantity),
        price: String(i.unit_price),
        weight: Math.round(Number(record(i.products).weight_kg ?? 0) * 1000),
      }));
      const { data: previous, error: previousErr } = await db
        .from("shipments")
        .select("id,reference_no,status")
        .eq("order_id", order.id)
        .not("status", "in", "(archived,canceled)")
        .limit(10);
      if (previousErr) throw previousErr;
      return reply({ draft, order_code: order.code, previous });
    }
    if (
      ["save_settings", "save_cod", "grant", "revoke", "admin_data"].includes(
        action,
      )
    ) {
      if (!manager) return fail("forbidden", 403);
      if (action === "admin_data") {
        const page = Math.max(
          0,
          Math.min(10000, Number.isInteger(b.page) ? Number(b.page) : 0),
        );
        const [users, accounts] = await Promise.all([
          db
            .from("profiles")
            .select("id,full_name,role,is_active")
            .in("role", ["staff", "owner", "admin"])
            .order("id")
            .range(page * 50, page * 50 + 49),
          db
            .from("shipping_cod_accounts")
            .select("*")
            .order("id")
            .range(page * 50, page * 50 + 49),
        ]);
        for (const r of [users, accounts]) if (r.error) throw r.error;
        const grants = users.data?.length
          ? await db
              .from("shipping_permissions")
              .select("user_id")
              .in(
                "user_id",
                users.data.map((u) => u.id),
              )
          : { data: [], error: null };
        if (grants.error) throw grants.error;
        return reply({
          users: users.data,
          grants: grants.data,
          accounts: accounts.data,
        });
      }
      if (action === "save_settings") {
        const s = record(b.settings);
        if (
          !["uat", "production"].includes(String(s.environment)) ||
          !["unconfirmed", "prepaid", "postpaid"].includes(
            String(s.billing_mode),
          )
        )
          return fail("invalid_settings");
        const d = emptyDraft();
        d.origin = s.origin as typeof d.origin;
        const origin = parseDraft(d).origin;
        const { error } = await db
          .from("shipping_settings")
          .update({
            environment: s.environment,
            billing_mode: s.billing_mode,
            merchant_code: small(s.merchant_code),
            origin,
            updated_by: userId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", true);
        if (error) throw error;
        return reply({ ok: true });
      }
      if (action === "save_cod") {
        const a = record(b.account);
        if (
          !isUuid(a.id) ||
          !small(a.label, 150) ||
          !small(a.provider_account_id) ||
          !settings.merchant_code ||
          typeof a.active !== "boolean"
        )
          return fail("invalid_cod_account");
        const { error } = await db.from("shipping_cod_accounts").upsert({
          id: a.id,
          label: small(a.label, 150),
          provider_account_id: small(a.provider_account_id),
          environment: settings.environment,
          merchant_code: settings.merchant_code,
          active: a.active,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        return reply({ ok: true });
      }
      if (!isUuid(b.user_id)) return fail("invalid_user");
      const { data: target, error } = await db
        .from("profiles")
        .select("role,is_active")
        .eq("id", b.user_id)
        .single();
      if (error || !target || target.role !== "staff")
        return fail("invalid_user");
      if (action === "grant" && !target.is_active) return fail("invalid_user");
      const { error: writeErr } = await db.from("shipping_permissions").upsert({
        user_id: b.user_id,
        granted_by: userId,
        updated_at: new Date().toISOString(),
      });
      if (writeErr) throw writeErr;
      if (action === "revoke") {
        const { error } = await db
          .from("shipping_permissions")
          .delete()
          .eq("user_id", b.user_id);
        if (error) throw error;
      }
      return reply({ ok: true });
    }
    if (action === "create_draft") {
      if (!isUuid(b.id)) return fail("invalid_id");
      const draft = parseDraft(b.draft);
      let orderCode: string | null = null;
      const orderId = b.order_id ?? null;
      if (orderId !== null) {
        if (!isUuid(orderId)) return fail("invalid_order");
        const { data, error } = await db
          .from("orders")
          .select("code,status")
          .eq("id", orderId)
          .single();
        if (error || !data || ["cancelled", "returned"].includes(data.status))
          return fail("invalid_order");
        orderCode = data.code;
      }
      const row = {
        id: b.id,
        reference_no: `SHP-${b.id}`,
        order_id: orderId,
        order_code: orderCode,
        draft,
        status: "draft",
        environment: settings.environment,
        merchant_code: settings.merchant_code,
        created_by: userId,
        updated_by: userId,
      };
      const { data, error } = await db
        .from("shipments")
        .insert(row)
        .select("*")
        .single();
      if (error?.code === "23505") {
        const old = await db
          .from("shipments")
          .select("*")
          .eq("id", b.id)
          .eq("created_by", userId)
          .single();
        if (old.error) throw old.error;
        return reply({ shipment: old.data });
      }
      if (error) throw error;
      return reply({ shipment: data });
    }
    if (!isUuid(b.id)) return fail("invalid_id");
    const { data: row, error: readErr } = await db
      .from("shipments")
      .select("*")
      .eq("id", b.id)
      .single();
    if (readErr) return fail("not_found", 404);
    const shipment = row as Shipment;
    if (action === "get") {
      const { data: events, error } = await db
        .from("shipping_audit")
        .select("operation,old_status,new_status,created_at")
        .eq("entity", "shipments")
        .eq("entity_id", shipment.id)
        .order("id", { ascending: false })
        .limit(50);
      if (error) throw error;
      return reply({ shipment: shipmentWithContactFields(shipment), events });
    }
    const mutate = async (
      patch: Record<string, unknown>,
      allowed: string[],
    ) => {
      if (!Number.isInteger(b.version) || b.version !== shipment.version)
        throw new Error("conflict");
      const { data, error } = await db
        .from("shipments")
        .update({
          ...patch,
          version: shipment.version + 1,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment.id)
        .eq("version", b.version)
        .in("status", allowed)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("conflict");
      return data;
    };
    if (action === "save_draft")
      return reply({
        shipment: await mutate({ draft: parseDraftUpdate(b.draft, shipment.draft) }, ["draft"]),
      });
    if (action === "archive")
      return reply({
        shipment: await mutate({ status: "archived" }, ["draft"]),
      });
    if (
      row.environment !== settings.environment ||
      row.merchant_code !== settings.merchant_code
    )
      return fail("account_changed", 409);
    if (action === "quote") {
      assertProviderReady(config, false);
      const d = parseDraft(shipment.draft);
      if (!d.carrier_code) return fail("carrier_required");
      const result = await compareShippingRates(config, d, [d.carrier_code]);
      return reply({ ...result, rates: result.rates.filter((rate) => rate.available) });
    }
    if (action === "submit") {
      assertProviderReady(config, true);
      if (!settings.merchant_code || settings.billing_mode === "unconfirmed")
        return fail("provider_not_ready", 503);
      if (
        shipment.status !== "draft" ||
        readyIssues(parseDraft(shipment.draft)).length
      )
        return fail("shipment_incomplete");
      let cod: string | null = null;
      if (moneyMinor(shipment.draft.cod_amount) > 0) {
        const { data, error } = await db
          .from("shipping_cod_accounts")
          .select("provider_account_id")
          .eq("id", shipment.draft.cod_account_id)
          .eq("active", true)
          .eq("environment", row.environment)
          .eq("merchant_code", row.merchant_code)
          .single();
        if (error || !data) return fail("invalid_cod_account");
        cod = data.provider_account_id;
      }
      if (shipment.order_id) {
        const { data, error } = await db
          .from("orders")
          .select("status")
          .eq("id", shipment.order_id)
          .single();
        if (error || !data || ["cancelled", "returned"].includes(data.status))
          return fail("invalid_order");
      }
      const payload = providerPayload(shipment, cod);
      // Claim the draft before calling the provider. Concurrent submissions cannot both win.
      await mutate({ status: "submitting" }, ["draft"]);
      const attemptId = crypto.randomUUID();
      const { error: attemptErr } = await db.from("shipping_attempts").insert({
        id: attemptId,
        shipment_id: shipment.id,
        operation: "create",
        outcome: "pending",
        created_by: userId,
      });
      if (attemptErr) throw new Error("outcome_unknown");
      let outcome = "outcome_unknown",
        tracking: string | null = null,
        http: number | null = null,
        requestId: string | null = null;
      try {
        const r = await requestProvider(config, "create", payload);
        http = r.status;
        requestId = small(r.data.request_id) || null;
        const t = record(r.data.data).tracking_number;
        if (
          [200, 201].includes(r.status) &&
          typeof t === "string" &&
          /^[A-Za-z0-9-]{5,80}$/.test(t)
        ) {
          tracking = t;
          outcome = "waiting";
        }
      } catch {
        /* Any uncertain mutation outcome remains blocked from retry. */
      }
      const { error: finishErr } = await db
        .from("shipping_attempts")
        .update({
          outcome: tracking ? "success" : "unknown",
          http_status: http,
          provider_request_id: requestId,
          finished_at: new Date().toISOString(),
        })
        .eq("id", attemptId);
      const { data, error } = await db
        .from("shipments")
        .update({
          status: outcome,
          tracking_number: tracking,
          version: shipment.version + 2,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipment.id)
        .eq("status", "submitting")
        .eq("version", shipment.version + 1)
        .select("*")
        .single();
      if (error || finishErr) throw new Error("outcome_unknown");
      return reply({ shipment: data });
    }
    if (action === "print") {
      if (!shipment.tracking_number) return fail("tracking_required");
      const r = await requestProvider(config, "print", {
        carrier_code: shipment.draft.carrier_code,
        tracking_number: [shipment.tracking_number],
        show_order: 1,
      });
      const link = record(r.data.data).link;
      if (r.status !== 200 || typeof link !== "string")
        return fail("provider_response_invalid", 502);
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        return fail("provider_response_invalid", 502);
      }
      if (url.protocol !== "https:" || url.username || url.password)
        return fail("provider_response_invalid", 502);
      return reply({ link: url.toString() });
    }
    if (action === "refresh_status") {
      if (!shipment.tracking_number) return fail("tracking_required");
      const r = await requestProvider(config, "list", undefined, {
        viewpoint: "all",
        search: shipment.tracking_number,
        limit: "25",
      });
      if (r.status !== 200 || !Array.isArray(r.data.data))
        return fail("provider_response_invalid", 502);
      const found = r.data.data
        .map(record)
        .find(
          (x) =>
            x.tracking_number === shipment.tracking_number &&
            x.carrier_code === shipment.draft.carrier_code,
        );
      if (!found) return fail("provider_response_invalid", 502);
      const time = String(found.update_date ?? "");
      if (
        !/[Zz]|[+-]\d\d:\d\d$/.test(time) ||
        !acceptStatus(
          shipment.status,
          String(found.status),
          row.provider_updated_at,
          time,
        )
      )
        return reply({ shipment, unchanged: true });
      return reply({
        shipment: await mutate(
          { status: found.status, provider_updated_at: time },
          [shipment.status],
        ),
      });
    }
    return fail("unsupported_action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = [
      "invalid_money",
      "invalid_text",
      "invalid_payload",
      "invalid_quantity",
      "invalid_items",
      "invalid_cod_account",
      "conflict",
      "provider_not_ready",
      "shipment_incomplete",
      "quote_incomplete",
      "invalid_parcels",
      "client_outdated",
      "carrier_required",
      "carrier_unavailable",
      "provider_rejected",
      "outcome_unknown",
      "provider_response_invalid",
    ];
    return fail(
      safe.includes(message) ? message : "shipping_error",
      message === "conflict" || message === "client_outdated"
        ? 409
        : message === "provider_not_ready"
          ? 503
          : 400,
    );
  }
});
