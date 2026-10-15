import type { ImgHTMLAttributes } from 'react';
import { productListImage } from '../lib/product-list-image';

/** Fast list image; hover/full preview continues to use the original URL. */
export default function ProductListImage({ src, onError, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
    return <img {...props} src={src ? productListImage(src) : src} decoding="async" onError={(event) => {
        if (src && event.currentTarget.getAttribute('src') !== src) {
            event.currentTarget.src = src;
            return;
        }
        onError?.(event);
    }} />;
}
