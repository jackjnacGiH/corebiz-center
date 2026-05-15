# CoreBiz Center — Design System

> Single source of truth for visual language. Inspired by **GoSell ERP** (B2B, navy professional) and **Commerzy** (clean light) — adapted to Indigo brand palette.

**Stack:** Tailwind CSS v4 (CSS-first via `@tailwindcss/vite`) + shadcn/ui (new-york style, neutral base) + `lucide-react` icons.

---

## 1. Color Tokens

All colors are CSS variables declared in `src/index.css :root`. Reference them as `var(--token-name)` in custom CSS or `bg-primary` / `text-primary` etc. in Tailwind utilities (mapped via `@theme inline`).

### Brand — Indigo

| Token | Hex | Use |
|---|---|---|
| `--primary-50`  | `#EEF2FF` | Active-state background (nav link, filter chip) |
| `--primary-100` | `#E0E7FF` | Hover background, badge border |
| `--primary-500` | `#6366F1` | **Primary CTA**, brand mark, icon accent |
| `--primary-600` | `#4F46E5` | CTA hover, link active, icon on tint |
| `--primary-700` | `#4338CA` | Active text on `primary-50` background |
| `--primary-900` | `#312E81` | Reserved for high-contrast accents |

### Neutral — Gray

| Token | Hex | Use |
|---|---|---|
| `--neutral-50`  | `#F9FAFB` | Page background |
| `--neutral-100` | `#F3F4F6` | Sidebar hover, card alt, sub-panel |
| `--neutral-200` | `#E5E7EB` | Border default, divider |
| `--neutral-300` | `#D1D5DB` | Border strong (hover state) |
| `--neutral-500` | `#6B7280` | Muted text |
| `--neutral-700` | `#374151` | Secondary text |
| `--neutral-900` | `#111827` | Primary text, brand text |

### Status

| Token | Hex | Use |
|---|---|---|
| `--success-500` `--success-600` `--success-700` | `#10B981` / `#059669` / `#047857` | In-stock, paid, approved |
| `--warning-500` `--warning-700` | `#F59E0B` / `#B45309` | Low stock, pending |
| `--danger-500` `--danger-600` `--danger-700` | `#EF4444` / `#DC2626` / `#B91C1C` | Out of stock, error, destructive |
| `--info-500` `--info-600` | `#3B82F6` / `#2563EB` | Informational links |

### Tint pairs (badge / pill backgrounds)

Always pair a `*-50` background with `*-700` text and `*-100` border:

```css
.badge-success { background: var(--success-50); color: var(--success-700); border: 1px solid var(--success-100); }
```

---

## 2. Typography

- **Font:** `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- **Smoothing:** `-webkit-font-smoothing: antialiased`
- **Letter spacing:** Headings = `-0.01em`. Eyebrow / caps = `+0.08em`.

| Role | Class / Size | Weight |
|---|---|---|
| Display H1 | `text-2xl` to `clamp(1.5rem, 2vw, 1.875rem)` | 600 |
| H2 | `text-lg` (1.125 rem) | 600 |
| Body | `text-sm` (0.875 rem) | 400 |
| Body strong | `text-sm` | 500–600 |
| Caption / Meta | `text-xs` (0.75 rem) | 500 |
| Eyebrow (uppercase) | 0.72 rem | 700, `letter-spacing: 0.08em` |
| Mono (SKU, code) | `ui-monospace, SFMono-Regular, Menlo, Consolas` | 500 |

---

## 3. Spacing & Layout

Tailwind's default 4px scale. Use multiples of 4.

| Element | Token | Value |
|---|---|---|
| Sidebar (expanded) | `--sidebar-width` | 240 px |
| Sidebar (collapsed) | `--sidebar-collapsed-width` | 64 px |
| TopBar | `--header-height` | 56 px |
| Page padding | — | 24 px (`p-6`) |
| Card padding | — | 16–20 px (`p-4` / `p-5`) |
| Section gap | — | 16–24 px (`gap-4` / `gap-6`) |
| Max content | — | 1440 px center |

---

## 4. Radii

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 6 px | Small chips, filter buttons |
| `--radius` | 8 px | Default — buttons, inputs, cards |
| `--radius-md` | 10 px | Larger panels |
| `--radius-lg` | 12 px | Hero cards, modals |
| `--radius-xl` | 16 px | Big shells |

---

## 5. Shadows

| Token | Value | Use |
|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(15,23,42,.04)` | Cards at rest |
| `--shadow-sm` | `0 1px 3px / 1px 2px` | Default subtle |
| `--shadow-md` | `0 4px 6px-1px / 2px 4px-2px` | Hover card lift |
| `--shadow-lg` | `0 10px 20px-3px / 4px 8px-4px` | Dropdown, popover |

Avoid stacked drop-shadows. One shadow at a time.

---

## 6. Motion

- **Default transition:** `180ms cubic-bezier(0.4, 0, 0.2, 1)` (declared as `--transition`)
- **Fade in:** `animation: fadeIn 200ms ease-out`
- Do not animate layout properties (`width`, `top`). Animate `transform`, `opacity`, `box-shadow`, `background-color`, `border-color`.

---

## 7. Component Patterns

### 7.1 Layout shell

```
.app-layout          → grid: [sidebar 240px] [main 1fr], 100vh
  .sidebar           → white bg, right border neutral-200, sticky
  .main-content      → flex column
    .header          → 56px sticky topbar, white/blur, border-b
    .page-content    → p-6 (mobile p-4), flex-1
```

### 7.2 Nav link (sidebar)

```
.nav-link            → 38px row, neutral-600 text, radius 8px, gap 0.7rem
  :hover             → neutral-100 bg, text-main
  .active            → primary-50 bg, primary-700 text, weight 600
    ::before         → 3px×20px primary-500 bar on left edge
    svg              → primary-600
```

### 7.3 Card

Three flavors:
1. **`.glass-card`** — generic white card, radius-lg, shadow-xs (legacy compat)
2. **shadcn `<Card>`** — preferred for new pages
3. **`.commerce-product-card`** — flex column, 370 min-h, image on top

### 7.4 Buttons

| Variant | Background | Text | Border | Use |
|---|---|---|---|---|
| Primary | `primary-500` (hover `-600`) | white | `primary-600` | Main CTAs |
| Secondary | white | neutral-900 | `neutral-200` | Secondary actions |
| Ghost | transparent (hover `neutral-100`) | neutral-600 | none | Tertiary, table rows |
| Destructive | `danger-500` (hover `-600`) | white | `danger-600` | Delete, sign out |

Heights: **38–40 px** standard, **34 px** dense table-toolbar, **44 px** form-submit.

### 7.5 Badge / Status pill

```html
<span class="badge badge-success">In stock</span>
<span class="badge badge-warning">Low</span>
<span class="badge badge-danger">Out</span>
<span class="badge badge-primary">New</span>
```

Pattern: `bg = *-50`, `text = *-700`, `border = *-100`. Rounded-full, 0.2/0.55 padding, 0.72 rem.

### 7.6 Input

- Height **36 px** (h-9)
- Border `neutral-200`, hover/focus `neutral-300`
- Background `neutral-50` for search bars, `white` for forms
- Focus ring: `--ring` = `primary-500` at 2 px outline-offset

### 7.7 Table

- Header: `neutral-50` bg, `neutral-700` text 0.78 rem uppercase tracking-0.05
- Row hover: `neutral-50`
- Cell padding: `12px 16px`
- Divider: `border-b border-neutral-200`
- Sort indicator: lucide `ChevronUp/Down` 12 px aligned center

### 7.8 Empty state

```
.commerce-empty-state
  → dashed border-strong, radius-8px, min-h 240px,
  → grid place-items-center, text-muted center
```

---

## 8. shadcn/ui — installed primitives

`src/components/ui/` contains the headless primitives. **Use these for new pages**:

| Component | File | Notes |
|---|---|---|
| Button | `button.tsx` | variants: default, destructive, outline, secondary, ghost, link |
| Input | `input.tsx` | h-9, focus-visible:ring-ring |
| Card | `card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter |
| Table | `table.tsx` | Table, TableHeader, TableBody, TableRow, TableHead, TableCell |
| Badge | `badge.tsx` | variants: default, secondary, destructive, outline |
| Dialog | `dialog.tsx` | Radix-backed modal |
| DropdownMenu | `dropdown-menu.tsx` | Radix-backed menu |
| Avatar | `avatar.tsx` | image + fallback initials |
| Separator | `separator.tsx` | horizontal/vertical divider |
| Sheet | `sheet.tsx` | side drawer (mobile sidebar) |
| Tabs | `tabs.tsx` | TabsList / TabsTrigger / TabsContent |
| Label | `label.tsx` | form labels |

Add more with `npx shadcn@latest add <name>`.

---

## 9. Icons

**`lucide-react` only.** Default size 20 px in nav, 16 px in dense UI, 18 px in topbar. Never mix icon libraries.

```tsx
import { Package, ShoppingCart } from 'lucide-react'
<Package size={20} />
```

---

## 10. Light/Dark theme

Light only. Dark mode tokens are reserved (`.dark` variant declared but not active). Do **not** ship dark variants until Boss Jack approves.

---

## 11. Migration notes

- Tailwind v4 = **no `tailwind.config.js`** (deleted). All config lives in `src/index.css` under `@theme inline { ... }`.
- Path alias `@/*` → `./src/*` (configured in `tsconfig.json` + `vite.config.ts`).
- `cn()` helper at `src/lib/utils.ts` — use in every shadcn component for class merging.
- Custom legacy classes (`.sidebar`, `.nav-link`, `.commerce-*`, etc.) stay until pages are refactored in Prompts #4–7. Don't remove them yet — `Layout.tsx`, `Ecommerce.tsx` still depend on them.

---

## 12. Do / Don't

✅ **Do**
- Use shadcn primitives + Tailwind utilities for new components
- Reference design tokens via CSS vars, never raw hex
- Stick to 8 px multiples for spacing
- Use `lucide-react` icons sized 16 / 18 / 20 px
- Prefer `Card` over `.glass-card` for new pages

❌ **Don't**
- Add new dark-theme styles
- Import another icon library
- Bake hex colors into component classes
- Override shadcn primitives globally — copy and customize per-page if needed
- Reintroduce `glassmorphism` / `backdrop-blur` panels — we are flat & professional

---

_Last updated: 2026-05-15 — UI Refactor Prompt #2_
