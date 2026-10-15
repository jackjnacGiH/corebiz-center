import variants from './product-image-variants.json';

const origin = 'https://owoedccmuqnzdtxvywgt.supabase.co';
const prefix = '/storage/v1/object/public/products/';
export function productListImage(src: string): string {
    try {
        const url = new URL(src);
        if (url.origin !== origin || !url.pathname.startsWith(prefix) || url.search) return src;
        const path = decodeURIComponent(url.pathname.slice(prefix.length));
        const variant = (variants as Record<string, string>)[path];
        return variant ? `${origin}${prefix}${variant}` : src;
    } catch { return src; }
}
