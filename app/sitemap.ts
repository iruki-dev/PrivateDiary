import type { MetadataRoute } from "next";
import { ALL_DOC_PAGES } from "@/lib/docs";
import { SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/docs", ...ALL_DOC_PAGES.map((page) => page.href)].map((path) => ({
    url: `${SITE.url}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.5,
  }));
}
