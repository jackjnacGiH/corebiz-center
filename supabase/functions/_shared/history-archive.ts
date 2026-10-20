type ArchiveRow = Record<string, unknown>;
export type VerifiedArchive = {
  source: string; cutoff: string; rows: ArchiveRow[];
  objectPath: string; sha256: string; byteLength: number;
};

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A failed upload/read-back/hash check must never reach the pruning RPC. */
export async function archiveVerifiedBatch(options: {
  source: string; cutoff: string; rows: ArchiveRow[];
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  download: (path: string) => Promise<Uint8Array>;
  commit: (archive: VerifiedArchive) => Promise<unknown>;
}) {
  if (!options.rows.length) return null;
  const json = new TextEncoder().encode(JSON.stringify(options.rows));
  const compressed = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  const checksum = await sha256(bytes);
  const objectPath = `${options.source}/${options.cutoff.slice(0, 10)}/${checksum}.json.gz`;
  await options.upload(objectPath, bytes);
  const copy = await options.download(objectPath);
  if (copy.byteLength !== bytes.byteLength || await sha256(copy) !== checksum) {
    throw new Error('archive_verification_failed');
  }
  return options.commit({
    source: options.source, cutoff: options.cutoff, rows: options.rows,
    objectPath, sha256: checksum, byteLength: bytes.byteLength,
  });
}
