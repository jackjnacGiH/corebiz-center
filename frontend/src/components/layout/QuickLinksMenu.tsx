import { useEffect, useRef, useState } from 'react';
import { Link2, Plus, ChevronDown, ExternalLink, Trash2, Loader2, ChevronUp } from 'lucide-react';
import { quickLinkApi, type QuickLink } from '../../lib/api';
import { cn } from '@/lib/utils';

function normalizeUrl(u: string): string {
  const s = u.trim();
  if (!s) return s;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/**
 * Sidebar "Link>>" — an expandable menu of staff-managed external bookmarks.
 * "+" adds a link (label + URL, unlimited); clicking a sub-item opens the URL
 * in a new tab. Collapsed rail mode shows the list as a floating flyout.
 */
export default function QuickLinksMenu({
  collapsed,
  onItemClick,
}: {
  collapsed: boolean;
  onItemClick?: () => void;
}) {
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    quickLinkApi.list().then(setLinks).catch(() => undefined);
  }, []);

  // Close the collapsed flyout when clicking outside.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function save() {
    const l = label.trim();
    const u = normalizeUrl(url);
    if (!l || !u) {
      setErr('กรุณากรอกชื่อและลิงก์');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const created = await quickLinkApi.create(l, u);
      setLinks((prev) => [...prev, created]);
      setLabel('');
      setUrl('');
      setAdding(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setLinks((prev) => prev.filter((x) => x.id !== id));
    try {
      await quickLinkApi.remove(id);
    } catch {
      /* re-load on failure */
      quickLinkApi.list().then(setLinks).catch(() => undefined);
    }
  }

  /** Move a link up (dir -1) or down (dir +1), then persist the new order. */
  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= links.length) return;
    const next = [...links];
    [next[index], next[j]] = [next[j], next[index]];
    setLinks(next);
    quickLinkApi.reorder(next.map((l) => l.id)).catch(() => {
      quickLinkApi.list().then(setLinks).catch(() => undefined);
    });
  }

  return (
    <div className="relative" ref={ref}>
      {/* Header row */}
      <div
        className={cn('nav-link', collapsed && 'nav-link--collapsed', 'cursor-pointer')}
        onClick={() => setOpen((o) => !o)}
        role="button"
        title={collapsed ? 'Link>>' : undefined}
      >
        <Link2 size={20} />
        {!collapsed && (
          <>
            <span className="truncate flex-1">Link&gt;&gt;</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
                setAdding(true);
              }}
              title="เพิ่มลิงก์"
              className="p-0.5 rounded hover:bg-black/10"
            >
              <Plus size={16} />
            </button>
            <ChevronDown
              size={16}
              className={cn('transition-transform', open && 'rotate-180')}
            />
          </>
        )}
      </div>

      {/* Submenu — inline when expanded sidebar, flyout when collapsed rail */}
      {open && (
        <div
          className={cn(
            collapsed
              ? 'absolute left-full top-0 ml-2 w-60 rounded-lg border border-neutral-200 bg-white shadow-xl p-2 z-50'
              : 'mt-1 ml-3 pl-3 border-l border-neutral-200 space-y-0.5',
          )}
        >
          {links.length === 0 && !adding && (
            <div className="text-xs text-neutral-400 px-2 py-1.5">ยังไม่มีลิงก์ — กด + เพื่อเพิ่ม</div>
          )}

          {links.map((l, i) => (
            <div key={l.id} className="group/li flex items-center gap-0.5">
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onItemClick}
                className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
              >
                <ExternalLink size={14} className="flex-shrink-0 text-neutral-400" />
                <span className="truncate">{l.label}</span>
              </a>
              <div className="flex items-center opacity-0 group-hover/li:opacity-100 transition flex-shrink-0">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="เลื่อนขึ้น"
                  className="p-0.5 text-neutral-400 hover:text-indigo-600 disabled:opacity-20 disabled:hover:text-neutral-400"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === links.length - 1}
                  title="เลื่อนลง"
                  className="p-0.5 text-neutral-400 hover:text-indigo-600 disabled:opacity-20 disabled:hover:text-neutral-400"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(l.id)}
                  title="ลบลิงก์"
                  className="p-0.5 text-neutral-300 hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}

          {collapsed && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full mt-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-indigo-600 hover:bg-indigo-50"
            >
              <Plus size={14} /> เพิ่มลิงก์
            </button>
          )}

          {adding && (
            <div className="mt-1 p-2 rounded-md bg-neutral-50 border border-neutral-200 space-y-1.5">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ชื่อลิงก์ (เช่น Facebook)"
                className="w-full text-sm rounded border border-neutral-200 px-2 py-1 outline-none focus:border-indigo-400"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder="https://..."
                className="w-full text-sm rounded border border-neutral-200 px-2 py-1 outline-none focus:border-indigo-400"
              />
              {err && <div className="text-[11px] text-red-600">{err}</div>}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={save}
                  className="flex-1 inline-flex items-center justify-center gap-1 text-xs rounded bg-indigo-600 text-white py-1.5 font-semibold disabled:opacity-50"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : null} บันทึก
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setErr(null);
                  }}
                  className="text-xs rounded border border-neutral-200 px-2.5 py-1.5 text-neutral-600"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
