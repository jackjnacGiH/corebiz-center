export const JNAC_BASE_PATH = process.env.NEXT_PUBLIC_JNAC_BASE_PATH ?? "";

export function jnacPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${JNAC_BASE_PATH}${normalized}`;
}
