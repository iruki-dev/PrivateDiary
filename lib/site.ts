/**
 * Public-facing facts about the service, in one place so the landing page,
 * legal pages, footer and metadata never disagree.
 *
 * Operator details come from the environment rather than being hard-coded:
 * they are a business decision for whoever deploys this, and a placeholder
 * shipping to production by accident is worse than an obviously-missing
 * value. When NEXT_PUBLIC_CONTACT_EMAIL is unset, contact falls back to the
 * repository's public issue tracker — real and reachable, never invented.
 */

const repositoryUrl = "https://github.com/iruki-dev/PrivateDiary";

function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  // Set automatically by Vercel at build time.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE = {
  name: "PrivateDiary",
  /** The product's own line, unchanged from the original metadata. */
  tagline: "누구도 아닌 나만 읽을 수 있는 일기",
  description:
    "누구도 아닌 나만 읽을 수 있는 일기. 일기는 기기에서 암호화된 뒤에 저장되며, 운영자를 포함한 누구도 내용을 읽을 수 없습니다.",
  url: siteUrl(),
  repositoryUrl,
  issuesUrl: `${repositoryUrl}/issues`,
  operatorName: process.env.NEXT_PUBLIC_OPERATOR_NAME || "PrivateDiary 운영자",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || null,
  /** Date the current privacy policy / terms took effect. */
  policyEffectiveDate: "2026년 10월 5일",
} as const;

/** mailto: when an address is configured, otherwise the public issue tracker. */
export function contactHref(): string {
  return SITE.contactEmail ? `mailto:${SITE.contactEmail}` : SITE.issuesUrl;
}

export function contactLabel(): string {
  return SITE.contactEmail ?? "GitHub 이슈";
}
