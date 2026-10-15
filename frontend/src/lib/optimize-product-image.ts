/** Only new product uploads are optimized. Keep animation and small originals;
 * use a high quality, bounded image and fall back on any browser encoder error. */
export async function optimizeProductImage(file: File): Promise<File> {
    if (file.size < 180_000 || !['image/jpeg', 'image/png'].includes(file.type)) return file;
    let bitmap: ImageBitmap | undefined;
    try {
        if (file.type === 'image/png') {
            // APNG must not silently turn into a still image.
            const header = new Uint8Array(await file.arrayBuffer());
            for (let i = 8; i + 12 <= header.length;) {
                const size = new DataView(header.buffer).getUint32(i);
                if (String.fromCharCode(...header.subarray(i + 4, i + 8)) === 'acTL') return file;
                if (size > header.length - i - 12) return file;
                i += size + 12;
            }
        }
        bitmap = await createImageBitmap(file);
        const ratio = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        const context = canvas.getContext('2d');
        if (!context) return file;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
        if (!blob || blob.type !== 'image/webp' || blob.size > file.size * 0.9) return file;
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp', lastModified: file.lastModified });
    } catch { return file; }
    finally { bitmap?.close(); }
}
