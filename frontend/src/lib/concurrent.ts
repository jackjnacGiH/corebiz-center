/** Work-conserving queue: keep the same concurrency limit without waiting for
 * a whole batch's slowest request. Results remain in input order. */
export async function mapSettledLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(limit))) }, async () => {
        while (next < items.length) {
            const index = next++;
            try { results[index] = { status: 'fulfilled', value: await work(items[index], index) }; }
            catch (reason) { results[index] = { status: 'rejected', reason }; }
        }
    }));
    return results;
}
