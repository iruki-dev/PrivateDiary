import type { MetadataRoute } from "next";

/**
 * Web app manifest — what makes PrivateDiary installable as a home-screen
 * app rather than only a bookmark.
 *
 * This matters more here than for a typical site: a diary is a daily,
 * private, phone-first habit, and a browser tab among thirty other tabs is
 * a bad container for one. `display: standalone` also removes the address
 * bar, which is the most obvious over-the-shoulder giveaway of what someone
 * is looking at — the same concern that motivated the private writing mode
 * (ARCHITECTURE.md §3.9).
 *
 * No service worker is registered, deliberately. Offline caching for this
 * app would mean persisting either ciphertext plus the key material to open
 * it, or plaintext, on the device — exactly the tradeoff lib/drafts.ts
 * keeps deliberately small, per-device and switchable off. An installable
 * shell without an offline cache gets the container benefits with none of
 * that.
 *
 * The colours mirror app/globals.css's light-mode --background/--foreground
 * so the splash screen doesn't flash a different colour than the app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PrivateDiary",
    short_name: "PrivateDiary",
    description: "누구도 아닌 나만 읽을 수 있는, 제로 지식 암호화 일기.",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      // Served from public/ rather than the app/icon convention: those get
      // a build-hashed URL that can't be referenced from here by a stable
      // path, and a manifest icon has to resolve by literal URL.
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // A separate maskable entry so Android can crop to its adaptive-icon
      // shape without clipping the padlock — the "any" icons above already
      // carry their own rounded plate and would get rounded twice.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
