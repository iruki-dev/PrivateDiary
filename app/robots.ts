import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/** Public pages only; every account route is also `noindex` in its own layout. */
// Built once; nothing here varies per request (and the Android static
// export, next.config.ts, requires it to be stated).
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/write", "/entries", "/settings", "/login", "/signup"],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
