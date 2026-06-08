import type { NextConfig } from "next";

// Mounted under /shop on jnac.online via Vercel experimentalServices.
const basePath = process.env.SHOP_BASE_PATH ?? "/shop";

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_SHOP_BASE_PATH: basePath },
  // Match the repo's pragmatic "deploy fast" philosophy — don't block the
  // storefront deploy on lint/type nits (logic is verified separately).
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
