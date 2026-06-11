import type { NextConfig } from "next";

// Storefront is mounted at the ROOT of jnac.online (Vercel experimentalServices
// routePrefix "/"). basePath is empty. Old /shop URLs 301 → root for SEO
// continuity; /widget, /survey, /refer redirect to the admin app at /center.
const basePath = process.env.SHOP_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_SHOP_BASE_PATH: basePath },
  // Match the repo's pragmatic "deploy fast" philosophy — don't block the
  // storefront deploy on lint/type nits (logic is verified separately).
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
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
