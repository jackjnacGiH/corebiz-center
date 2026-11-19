# Storefront prebuilt product images

Product and group photos use static, content-hashed WebP variants (320, 640 and
960px, without upscaling). These files ship with the storefront. Visitors do not
invoke Next.js/Vercel image transformations for catalog photos, including on
their first visit. Original public Storage files and database URLs are untouched.

## Refresh after uploading product/group photos

From the monorepo root with Node 24 and `npm ci` completed:

```powershell
node apps/storefront/scripts/prepare-catalog-images.mjs --dry-run
node apps/storefront/scripts/prepare-catalog-images.mjs
node --test tests/storefront-image-performance.test.mjs
npm run lint:storefront
npm run build:storefront
```

The script uses the existing read-only public catalog client. It requires no
service-role key, performs no database/Storage writes and invokes no paid image
API. Existing generated files are reused. Pass `--refresh` if an original was
replaced without changing its URL. Do not delete old assets during a refresh.
The script records failures in `image-preparation-report.json` and exits nonzero
for unavailable originals. Inspect those failures; only use
`--allow-unavailable` to acknowledge verified pre-existing missing sources.
Never substitute an unrelated photo. The UI falls back to the original and,
if that too is unavailable, displays an accessible unavailable-image message.
Commit the manifest and generated `public/catalog-images/` files together with
the implementation; deployment follows the normal verified PR/main workflow.

The manifest is read on the server. Only a selected photo's variant metadata is
passed to a client component, not the full manifest. New, unsupported, animated,
signed or unknown images retain their original URL until a suitable static
variant is available. A missing variant falls back to the original in the UI.
Full original images remain accessible from the product detail page.

This change adds no provider, subscription, runtime transform service or Storage
copies. Static hosting/bandwidth remains on the existing Vercel plan. It does not
change plan settings or authorize spending above that plan.

Catalog, group and search results initially show 30 entries with a Load more
button (category pages retain their existing pagination). The catalog retains
its five-minute static page cache. First-row photos are eager/high-priority; the remaining
photos stay lazy. Normal catalog data revalidation and legacy redirects remain.
