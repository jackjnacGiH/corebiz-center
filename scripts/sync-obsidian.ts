/**
 * sync-obsidian.ts
 * ---------------------------------------------------------------------------
 * Walks the Obsidian Vault, chunks each markdown note, calls Phaya for
 * embeddings, and upserts into Supabase `knowledge_chunks`.
 *
 * Usage:
 *   npm run sync             — sync only changed files (by content_hash)
 *   npm run sync:force       — re-embed every file (ignore hash cache)
 *   npm run sync:cleanup     — delete chunks whose source_path no longer exists
 *   npm run sync:dry         — show what would change, don't write
 * ---------------------------------------------------------------------------
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { createClient } from '@supabase/supabase-js';
import matter from 'gray-matter';
import 'dotenv/config';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SUPABASE_URL = required('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const PHAYA_API_KEY = required('PHAYA_API_KEY');
const PHAYA_API_URL = process.env.PHAYA_API_URL
  ?? 'https://api.phaya.io/api/v1/embedding/create';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_PATH = process.env.VAULT_PATH
  ? (process.env.VAULT_PATH.startsWith('/') || process.env.VAULT_PATH.match(/^[a-zA-Z]:/)
      ? process.env.VAULT_PATH
      : join(__dirname, process.env.VAULT_PATH))
  : join(__dirname, '..', 'vault');

const CHUNK_MAX_TOKENS = Number(process.env.CHUNK_MAX_TOKENS ?? 500);
const CHUNK_OVERLAP_TOKENS = Number(process.env.CHUNK_OVERLAP_TOKENS ?? 50);

const FORCE = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const CLEANUP = process.argv.includes('--cleanup');

// Folders to skip entirely (never sync)
const SKIP_FOLDERS = new Set(['00-templates', '.obsidian', '.trash']);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Frontmatter {
  type?: string;
  title?: string;
  sku?: string;
  sync?: boolean;
  language?: 'th' | 'en' | 'mixed';
  visibility?: 'public' | 'internal';
  tags?: string[];
}

interface Chunk {
  source_path: string;
  source_type: 'obsidian';
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  language: 'th' | 'en' | 'mixed';
  chunk_index: number;
  content_hash: string;
  tags: string[];
  visibility: 'public' | 'internal';
  token_count: number;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Vault path: ${VAULT_PATH}`);
  console.log(`Mode: ${DRY_RUN ? 'dry-run' : CLEANUP ? 'cleanup' : FORCE ? 'force' : 'incremental'}`);

  if (CLEANUP) {
    await cleanupOrphans();
    return;
  }

  const files = await walkMarkdown(VAULT_PATH);
  console.log(`Found ${files.length} markdown files`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const absPath of files) {
    const relPath = relative(VAULT_PATH, absPath).split(sep).join('/');
    try {
      const result = await syncFile(absPath, relPath);
      if (result === 'inserted') inserted += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    } catch (err) {
      errors += 1;
      console.error(`  ✗ ${relPath} — ${(err as Error).message}`);
    }
  }

  console.log('\n─────────────────────────────────────');
  console.log(`✓ Inserted: ${inserted}`);
  console.log(`✓ Updated:  ${updated}`);
  console.log(`· Skipped:  ${skipped}`);
  if (errors) console.log(`✗ Errors:   ${errors}`);
  console.log('─────────────────────────────────────');
}

// ---------------------------------------------------------------------------
// Walk vault recursively for .md files
// ---------------------------------------------------------------------------
async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_FOLDERS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkMarkdown(full)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync a single file
// ---------------------------------------------------------------------------
async function syncFile(absPath: string, relPath: string): Promise<'inserted' | 'updated' | 'skipped'> {
  const raw = await readFile(absPath, 'utf8');
  const { data, content } = matter(raw);
  const fm = data as Frontmatter;

  if (fm.sync === false) {
    return 'skipped';
  }

  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) {
    return 'skipped';
  }

  const fileHash = hash(raw);

  // Check if we already have this exact file content
  if (!FORCE) {
    const { data: existing } = await supabase
      .from('knowledge_chunks')
      .select('id, content_hash, chunk_index')
      .eq('source_path', relPath);

    if (existing && existing.length === chunks.length) {
      const allMatch = chunks.every((c, i) => {
        const found = existing.find(e => e.chunk_index === i);
        return found && found.content_hash === hash(c);
      });
      if (allMatch) {
        return 'skipped';
      }
    }
  }

  const title = fm.title ?? deriveTitleFromFilename(relPath);
  const tags = fm.tags ?? [];
  const visibility = fm.visibility ?? (relPath.startsWith('06-internal/') ? 'internal' : 'public');
  const language = fm.language ?? 'th';

  const records: Chunk[] = chunks.map((text, idx) => ({
    source_path: relPath,
    source_type: 'obsidian',
    title,
    content: text,
    metadata: {
      type: fm.type ?? 'knowledge',
      sku: fm.sku,
      file_hash: fileHash,
    },
    language,
    chunk_index: idx,
    content_hash: hash(text),
    tags,
    visibility,
    token_count: approxTokens(text),
  }));

  console.log(`  → ${relPath} (${chunks.length} chunks)`);

  if (DRY_RUN) {
    return 'updated';
  }

  // Get embeddings (batch in groups of 8 to be polite to API)
  const embeddings = await embedBatch(records.map(r => r.content));

  // Delete existing chunks for this file (clean re-write)
  const { error: delErr } = await supabase
    .from('knowledge_chunks')
    .delete()
    .eq('source_path', relPath);
  if (delErr) throw new Error(`delete failed: ${delErr.message}`);

  // Insert fresh
  const payload = records.map((r, i) => ({ ...r, embedding: embeddings[i] }));
  const { error: insErr } = await supabase
    .from('knowledge_chunks')
    .insert(payload);
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);

  return 'updated';
}

// ---------------------------------------------------------------------------
// Cleanup orphan chunks (files deleted from vault)
// ---------------------------------------------------------------------------
async function cleanupOrphans() {
  const files = await walkMarkdown(VAULT_PATH);
  const existingPaths = new Set(
    files.map(f => relative(VAULT_PATH, f).split(sep).join('/'))
  );

  const { data, error } = await supabase
    .from('knowledge_chunks')
    .select('source_path');
  if (error) throw error;

  const storedPaths = new Set((data ?? []).map(r => r.source_path));
  const orphans = [...storedPaths].filter(p => !existingPaths.has(p));

  console.log(`Found ${orphans.length} orphan source_paths in DB`);
  for (const p of orphans) {
    console.log(`  ✗ removing ${p}`);
    if (!DRY_RUN) {
      const { error: delErr } = await supabase
        .from('knowledge_chunks')
        .delete()
        .eq('source_path', p);
      if (delErr) console.error(`    error: ${delErr.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking: split by H2 first, then by token cap
// ---------------------------------------------------------------------------
function chunkMarkdown(md: string): string[] {
  const trimmed = md.trim();
  if (!trimmed) return [];

  // Split on H2 (##) but keep the heading
  const sections = trimmed.split(/(?=^##\s)/m).map(s => s.trim()).filter(Boolean);

  const result: string[] = [];
  for (const sec of sections) {
    if (approxTokens(sec) <= CHUNK_MAX_TOKENS) {
      result.push(sec);
      continue;
    }
    // Section too large — split by paragraphs respecting token cap
    const paragraphs = sec.split(/\n\n+/);
    let buf = '';
    let bufTokens = 0;
    for (const para of paragraphs) {
      const paraTokens = approxTokens(para);
      if (bufTokens + paraTokens > CHUNK_MAX_TOKENS && buf) {
        result.push(buf.trim());
        // Carry an overlap from the previous chunk
        const overlap = tailTokens(buf, CHUNK_OVERLAP_TOKENS);
        buf = overlap ? overlap + '\n\n' + para : para;
        bufTokens = approxTokens(buf);
      } else {
        buf = buf ? buf + '\n\n' + para : para;
        bufTokens += paraTokens;
      }
    }
    if (buf.trim()) result.push(buf.trim());
  }
  return result;
}

function approxTokens(text: string): number {
  // Rough heuristic: Thai chars ~1 token each, English ~0.25 per char
  // Conservative: 1 token ≈ 3 chars for mixed Thai/English
  return Math.ceil(text.length / 3);
}

function tailTokens(text: string, tokens: number): string {
  const charCount = tokens * 3;
  return text.length > charCount ? text.slice(text.length - charCount) : '';
}

// ---------------------------------------------------------------------------
// Phaya embedding API call (batched)
// ---------------------------------------------------------------------------
async function embedBatch(texts: string[]): Promise<number[][]> {
  const BATCH = 8;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await fetch(PHAYA_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PHAYA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: slice }),
    });
    if (!res.ok) {
      throw new Error(`Phaya API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as { data?: Array<{ embedding: number[] }> };
    if (!data.data || data.data.length !== slice.length) {
      throw new Error(`Phaya API returned ${data.data?.length ?? 0} embeddings for ${slice.length} inputs`);
    }
    for (const item of data.data) results.push(item.embedding);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function hash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function deriveTitleFromFilename(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  return base.replace(/\.md$/, '').replace(/[-_]/g, ' ');
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------------------
main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
