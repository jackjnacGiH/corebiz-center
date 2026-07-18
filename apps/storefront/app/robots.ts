import type { MetadataRoute } from "next";
import { SHOP } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      {
        userAgent: ["OAI-SearchBot", "ClaudeBot", "PerplexityBot", "Google-Extended"],
        allow: "/",
      },
    ],
    sitemap: `${SHOP}/sitemap.xml`,
  };
}
