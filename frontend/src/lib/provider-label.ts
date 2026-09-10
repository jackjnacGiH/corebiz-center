const PDF_DATA_PREFIX = "data:application/pdf;base64,";
const MAX_PDF_BYTES = 1_400_000;
const MAX_PDF_BASE64_LENGTH = Math.ceil(MAX_PDF_BYTES / 3) * 4;

export type ProviderLabelResource =
  | { kind: "external"; href: string }
  | { kind: "pdf"; blob: Blob };

export function providerLabelResource(link: string): ProviderLabelResource {
  if (link.startsWith(PDF_DATA_PREFIX)) {
    const encoded = link.slice(PDF_DATA_PREFIX.length);
    if (
      !encoded.startsWith("JVBERi0") ||
      encoded.length > MAX_PDF_BASE64_LENGTH ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ) throw new Error("provider_response_invalid");
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      throw new Error("provider_response_invalid");
    }
    if (!binary.startsWith("%PDF-"))
      throw new Error("provider_response_invalid");
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return { kind: "pdf", blob: new Blob([bytes], { type: "application/pdf" }) };
  }
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("provider_response_invalid");
    return { kind: "external", href: url.toString() };
  } catch {
    throw new Error("provider_response_invalid");
  }
}
