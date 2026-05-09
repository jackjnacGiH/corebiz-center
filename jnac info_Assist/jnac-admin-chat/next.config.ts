import type { NextConfig } from "next";

const basePath = process.env.JNAC_BASE_PATH ?? "/jnac";

const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_JNAC_BASE_PATH: basePath,
  },
};

export default nextConfig;
