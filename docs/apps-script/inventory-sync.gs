/**
 * CoreBiz Inventory — Instant Sync
 * ──────────────────────────────────────────────────────────────────────────
 * Apps Script bound to the JNAC inventory Google Sheet. Whenever a user
 * edits a cell in the inventory tab, this fires a webhook at the CoreBiz
 * Edge Function so stock updates land in the DB within seconds instead of
 * waiting for the 15-minute pg_cron run.
 *
 * Setup instructions: see ../GOOGLE_SHEET_INSTANT_SYNC_SETUP.md
 *
 * Required Script Properties (Project Settings → Script Properties):
 *   SYNC_SECRET  — must match the constant in the Edge Function
 *
 * Required Installable Trigger (⏰ Triggers → Add Trigger):
 *   Function: onEditTrigger
 *   Event:    From spreadsheet → On edit
 */

// The gid of the inventory tab (only edits to THIS sheet should trigger).
// If you renamed the tab or added more tabs, find the gid in the URL bar:
//   https://docs.google.com/spreadsheets/d/.../edit#gid=1318634616
const WATCH_GID = 1318634616;

const WEBHOOK_URL =
  'https://owoedccmuqnzdtxvywgt.supabase.co/functions/v1/sync-inventory-from-sheet?source=webhook';

// Wait this long after a burst of edits before firing the webhook —
// so pasting 100 cells doesn't fire 100 webhooks.
const DEBOUNCE_MS = 2000;

/**
 * Installable onEdit handler. Don't use the simple onEdit() name — that
 * version of the trigger has reduced auth scope and can't call
 * UrlFetchApp. The installable trigger runs as the project owner with
 * full scope.
 */
function onEditTrigger(e) {
  if (!e || !e.range) return;
  // Only react to edits on the inventory sheet (ignore other tabs)
  if (e.range.getSheet().getSheetId() !== WATCH_GID) return;

  // Acquire a short-lived lock. If another execution is already firing
  // the webhook for this same burst of edits, just drop this call —
  // the one in flight will pick up the latest state anyway.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    return;
  }

  try {
    // Tiny pause: gives any rapid follow-up edits (paste, fill-down,
    // multi-cell selection) a chance to land before we hit the webhook.
    // The 2-second sleep is small enough that the user still perceives
    // the sync as "instant" — but big enough to dedupe burst writes.
    Utilities.sleep(DEBOUNCE_MS);

    const secret = PropertiesService.getScriptProperties()
      .getProperty('SYNC_SECRET');
    if (!secret) {
      Logger.log('SYNC_SECRET not configured in Script Properties — aborting');
      return;
    }

    const res = UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-secret': secret },
      payload: '{}',
      muteHttpExceptions: true,
    });

    Logger.log(
      'Sync fired: ' + res.getResponseCode() + ' — ' +
      res.getContentText().slice(0, 200),
    );
  } catch (err) {
    Logger.log('Sync webhook failed: ' + (err && err.stack ? err.stack : err));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Optional helper: run this manually from the Apps Script editor to
 * verify the webhook + secret are configured correctly. Should log
 * a 200 response.
 */
function testSyncWebhook() {
  const secret = PropertiesService.getScriptProperties()
    .getProperty('SYNC_SECRET');
  if (!secret) {
    Logger.log('SYNC_SECRET missing — set it in Script Properties first');
    return;
  }

  const res = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sync-secret': secret },
    payload: '{}',
    muteHttpExceptions: true,
  });

  Logger.log('Status: ' + res.getResponseCode());
  Logger.log('Body:   ' + res.getContentText());
}
