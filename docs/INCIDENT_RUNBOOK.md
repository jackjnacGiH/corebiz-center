# CoreBiz Center — Incident Runbook & Resilience Plan

> When something breaks, **don't panic** — most of CoreBiz's moving parts fail independently. Find which layer is down first, then follow the matching playbook. Keep this file current.

## Layers (fail independently)

| Layer | Where | If it's down… |
|---|---|---|
| **Vercel** (storefront `/`, admin `/center`, `/jnac`) | Vercel | site won't load / old build served |
| **Supabase DB / PostgREST** (`/rest/v1/`) | Supabase (ap-southeast-2) | data reads/writes fail everywhere |
| **Supabase Auth / GoTrue** (`/auth/v1/*`) | Supabase | **login fails** (email + Google + LINE); already-logged-in sessions keep working until token refresh |
| **Supabase Edge Functions** (`rag-chat`, `line-webhook`, …) | Supabase | bot/quote/notify features fail; DB + site still work |
| **LINE Messaging API** | LINE | bot can't send; quota-related (see below) |
| **Openclaw RAG API** (`api/`, Express) | wherever it's hosted (:3001) | knowledge ingestion/search only |

### 30-second triage (run these)

```bash
REF=owoedccmuqnzdtxvywgt
ANON="<VITE_SUPABASE_ANON_KEY>"
# DB / PostgREST  → expect HTTP 401 fast (=up). 5xx/timeout = DB down.
curl -s -o /dev/null -w "DB   %{http_code} %{time_total}s\n"  --max-time 20 "https://$REF.supabase.co/rest/v1/" -H "apikey: $ANON"
# Auth / GoTrue   → expect 200/4xx fast (=up). 522/timeout = Auth down.
curl -s -o /dev/null -w "AUTH %{http_code} %{time_total}s\n"  --max-time 20 "https://$REF.supabase.co/auth/v1/settings" -H "apikey: $ANON"
# Live site (Vercel)
curl -s -o /dev/null -w "WEB  %{http_code}\n" --max-time 20 "https://www.jnac.online/center/"
```
A **`HTTP 522` / timeout** = Cloudflare couldn't reach the Supabase origin → **Supabase-side outage** (not our code). A fast `401`/`200` = that layer is healthy.

---

## Playbook A — Supabase Auth (GoTrue) is down (login broken)

*Symptom:* login page → raw "supabase.co | 522: Connection timed out"; the triage shows AUTH 522 but DB 401. The admin app now catches this and shows a friendly "ระบบเข้าสู่ระบบขัดข้องชั่วคราว" message instead of the raw 522 (see `frontend/src/lib/auth.ts` `isAuthHealthy`).

1. **Confirm scope** with the triage above. If only AUTH is 522 and DB is 401, it's an Auth-service degradation. Note: the storefront (`/`) and the LINE bot keep working (they don't use interactive login).
2. **Check status.supabase.com** for an incident in `ap-southeast-2` or "Auth". If there's an active incident → **wait**; it usually self-heals in 15–60 min. Don't restart.
3. **If no incident is posted → restart the project.** Supabase dashboard → project **CoreBiz Center** → **Project Settings → General → Restart project** (or Infrastructure → Restart). ~1–2 min full downtime; usually revives a stuck GoTrue. *(Owner/Admin action — requires dashboard login.)*
4. **Do NOT pause/resume** the project to "fix" auth — pausing takes the healthy DB + storefront + bot offline too, and resume can be slow. Restart ≠ pause.
5. **Re-verify** with the triage; try logging in.
6. If still down after ~15 min → open a Supabase support ticket (Pro plan has faster support).

*Interim:* already-logged-in admins keep working for a while (cached JWT). New logins are blocked until Auth returns.

## Playbook B — Supabase DB / whole project down

1. Triage shows DB 522/timeout. Check status.supabase.com.
2. If `get_project` status is `PAUSED` → **restore** (dashboard → Restore project). Free-tier projects pause after long inactivity.
3. If `ACTIVE_HEALTHY` but 522 → platform incident; wait / restart / support (as Playbook A).
4. **Data loss?** → see Playbook E (backups / PITR).

## Playbook C — Vercel / site issues

- **Old build after push:** Vercel auto-deploys on push to `main`. Verify by polling the live JS chunk for a **marker string** you changed (build hashes differ local vs Vercel — CRLF/LF — so never match by hash). Check the Vercel dashboard deployment log.
- **Build failed:** check the Vercel build log. Note the GitHub Action lint is pre-existing-RED but harmless (no lint gate).

## Playbook D — Edge function broke after deploy

- **Golden rule:** deployed edge functions can be **newer than the repo copy**. Before redeploying, `get_edge_function` the live source, edit *that*, redeploy, then sync the repo. Re-deploying a stale repo copy silently reverts fixes.
- Check logs via the Supabase MCP `get_logs` / dashboard. Functions run with the service-role key; `verify_jwt:false` for webhooks/key-gated fns.

## Playbook E — LINE issues

- **"ไม่มีลิงก์ / ส่งไม่ถึงลูกค้า":** likely the **push quota (free = 300/mo) is exhausted**. The bot reply + quote link go out via the **free reply API** (line-webhook v20+), so they still work; admin Omni-Chat replies + CRM outreach use **push** and will fail. Check quota:
  ```bash
  TOKEN="<channel_access_token from line_channels>"
  curl -s "https://api.line.me/v2/bot/message/quota" -H "Authorization: Bearer $TOKEN"
  curl -s "https://api.line.me/v2/bot/message/quota/consumption" -H "Authorization: Bearer $TOKEN"
  ```
  Fix = **upgrade the LINE OA plan** or wait for the monthly reset. Team LINE notifications are already disabled (migration 0067) to conserve quota.
- **Bot not replying at all:** verify the LINE webhook URL + "Use webhook" is on in the LINE console, and Auto-reply/Greeting is off. Confirm `rag-chat` + `line-webhook` are healthy.

## Playbook F — Data backup & restore (DR)

- **Point-in-Time Recovery (PITR):** available on Supabase **Pro** — restore the DB to any second in the retention window from the dashboard. Strongly recommended; the free tier only has limited daily backups.
- **Off-Supabase export:** run `scripts/backup-db.sh` to pull a full `pg_dump` gzip to local/offsite storage (protects against account loss, not just DB corruption). See that script's header for the connection string + usage. Schedule it (Task Scheduler / cron / a GitHub Action on a cron with the DB URL as a secret) — e.g. daily.
- **Restore a dump:** `gunzip -c corebiz-YYYYMMDD.sql.gz | psql "$SUPABASE_DB_URL"` into a fresh project/branch (test first — never straight into prod).

---

## Monitoring & Alerting (set up once — biggest resilience win)

Right now outages are noticed only when someone tries to use the app. Add an external uptime monitor so you're alerted within minutes. **This is an owner action** (needs a monitoring account; free tiers are enough).

**Recommended:** [BetterStack Uptime](https://betterstack.com/uptime) or [UptimeRobot](https://uptimerobot.com) (both have free tiers; BetterStack supports custom headers on free, which helps for the Supabase checks).

Create these monitors (check every **1–5 min**):

| Monitor | URL | "Up" condition |
|---|---|---|
| **Admin app** | `https://www.jnac.online/center/` | HTTP 200 |
| **Storefront** | `https://www.jnac.online/` | HTTP 200 |
| **Supabase DB** | `https://owoedccmuqnzdtxvywgt.supabase.co/rest/v1/` (header `apikey: <ANON>`) | HTTP **401** or 200 (treat 5xx/timeout as down) |
| **Supabase Auth** | `https://owoedccmuqnzdtxvywgt.supabase.co/auth/v1/settings` (header `apikey: <ANON>`) | HTTP 200 (treat 5xx/timeout as down) |

Notes:
- For the DB monitor, **configure `401` as an accepted/"up" status** (an unauthenticated PostgREST root returns 401 when healthy) — otherwise it false-alarms.
- Timeout threshold ~10s (a healthy Supabase endpoint answers in <1s; the 522 path hangs ~20s).
- **Alerts:** email to the owner + (optional) a webhook. Keep alert channels off the Supabase/Vercel stack so an outage doesn't also take down the alert path.
- Optionally add a monitor for the LINE quota consumption endpoint (custom, via a small scheduled check) so you get warned before hitting 300/mo.

---

*Keep this runbook and `PROJECT_STANDARDS.md` updated when architecture or providers change.*
