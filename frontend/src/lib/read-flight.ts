// Share only reads that are currently in flight. Never reuse a settled result.
// Each view can stop waiting without cancelling another view's shared request.
type Flight = { promise: Promise<unknown>; controller: AbortController; consumers: number };
const flights = new Map<string, Flight>();

export function clearReadFlights(): void {
    for (const flight of flights.values()) flight.controller.abort();
    flights.clear();
}

export function shareRead<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const aborted = () => new DOMException('Read cancelled', 'AbortError');
    if (signal?.aborted) return Promise.reject(aborted());
    let flight = flights.get(key);
    if (!flight) {
        const controller = new AbortController();
        const entry: Flight = { controller, promise: Promise.resolve(), consumers: 0 };
        let timer: ReturnType<typeof setTimeout>;
        const cancelled = new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(aborted()), { once: true });
            timer = setTimeout(() => controller.abort(), 10_000);
        });
        entry.promise = Promise.race([Promise.resolve().then(() => fetcher(controller.signal)), cancelled])
            .finally(() => {
                clearTimeout(timer);
                if (flights.get(key) === entry) flights.delete(key);
            });
        flights.set(key, entry);
        flight = entry;
    }
    const entry = flight;
    entry.consumers++;
    return new Promise<T>((resolve, reject) => {
        let released = false;
        const release = (abandoned = false) => {
            if (released) return;
            released = true;
            signal?.removeEventListener('abort', cancel);
            entry.consumers--;
            // A brief handoff lets the room-opening effect join a prefetch.
            // Fully abandoned reads are then cancelled, rather than occupying
            // connections for ten seconds during rapid room switching.
            if (abandoned) setTimeout(() => {
                if (!entry.consumers && flights.get(key) === entry) {
                    flights.delete(key);
                    entry.controller.abort();
                }
            }, 100);
        };
        const cancel = () => { release(true); reject(aborted()); };
        signal?.addEventListener('abort', cancel, { once: true });
        (entry.promise as Promise<T>).then(
            data => { release(); resolve(data); },
            error => { release(); reject(error); },
        );
    });
}
