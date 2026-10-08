import type { NextConfig } from "next";

// Storefront is mounted at the ROOT of jnac.online (Vercel experimentalServices
// routePrefix "/"). basePath is empty. Old /shop URLs 301 → root for SEO
// continuity; /widget, /survey, /refer redirect to the admin app at /center.
const basePath = process.env.SHOP_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_SHOP_BASE_PATH: basePath },
  experimental: {
    // Bound build-time catalog reads to two workers with two pages each.
    cpus: 2,
    staticGenerationMaxConcurrency: 2,
  },
  async redirects() {
    return [
      // SEO continuity: the shop used to live under /shop.
      { source: "/shop", destination: "/", permanent: true },
      { source: "/shop/:path*", destination: "/:path*", permanent: true },
      // The admin app (incl. embedded chat widget + customer links) moved to /center.
      { source: "/widget", destination: "/center/widget", permanent: false, basePath: false },
      { source: "/survey/:path*", destination: "/center/survey/:path*", permanent: false, basePath: false },
      { source: "/refer/:path*", destination: "/center/refer/:path*", permanent: false, basePath: false },
    ];
  },
};

export default nextConfig;
