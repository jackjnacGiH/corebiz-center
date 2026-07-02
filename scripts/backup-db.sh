#!/usr/bin/env bash
#
# backup-db.sh — off-Supabase backup of the CoreBiz Postgres database.
#
# Produces a timestamped, gzipped pg_dump so you hold a copy OUTSIDE Supabase
# (protects against account/project loss, not just DB corruption — for which
# Supabase Pro PITR is the first line of defence). Keeps the latest 14 dumps.
#
# ── Usage ──────────────────────────────────────────────────────────────────
#   export SUPABASE_DB_URL="postgresql://postgres:<PASSWORD>@db.owoedccmuqnzdtxvywgt.supabase.co:5432/postgres"
#   ./scripts/backup-db.sh [output_dir]        # default output dir: ./backups
#
# Get the connection string from:
#   Supabase dashboard → Project Settings → Database → Connection string (URI)
#   (use the direct connection or the session pooler; URL-encode special chars
#    in the password). NEVER commit the password — pass it via the env var.
#
# ── Requirements ───────────────────────────────────────────────────────────
#   pg_dump / gzip on PATH. IMPORTANT: pg_dump major version must match the
#   server (Postgres 17). On Windows, install PostgreSQL 17 client tools and
#   run from Git Bash; on macOS `brew install postgresql@17`.
#
# ── Restore (into a TEST project/branch first — never straight to prod) ──────
#   gunzip -c backups/corebiz-YYYYMMDD-HHMMSS.sql.gz | psql "$SUPABASE_DB_URL"
#
# ── Scheduling ─────────────────────────────────────────────────────────────
#   Windows: Task Scheduler → daily → run this via Git Bash.
#   Linux/macOS cron:  0 3 * * *  SUPABASE_DB_URL=... /path/scripts/backup-db.sh
#   CI: a GitHub Action on a cron with SUPABASE_DB_URL as a repo secret (upload
#       the dump to a bucket/artifact; note artifacts have limited retention).
# ────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL — see the header of this script}"

OUT_DIR="${1:-./backups}"
KEEP="${BACKUP_KEEP:-14}"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/corebiz-$STAMP.sql.gz"

command -v pg_dump >/dev/null 2>&1 || { echo "ERROR: pg_dump not found on PATH (install PostgreSQL 17 client tools)"; exit 1; }

echo "→ Dumping CoreBiz database to $FILE ..."
# --no-owner / --no-privileges keep the dump portable across projects.
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges | gzip > "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ Backup complete: $FILE ($SIZE)"

# Retention: keep only the newest $KEEP dumps.
mapfile -t OLD < <(ls -1t "$OUT_DIR"/corebiz-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) || true)
if [ "${#OLD[@]}" -gt 0 ]; then
  printf '%s\n' "${OLD[@]}" | xargs -r rm -f
  echo "✓ Pruned ${#OLD[@]} old dump(s); kept newest $KEEP in $OUT_DIR"
fi
