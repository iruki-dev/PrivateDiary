/**
 * Which shell this build runs in. Decided at BUILD time
 * (`NEXT_PUBLIC_PLATFORM=android`, set by scripts/build-android-web.mjs),
 * never sniffed from the user agent at runtime: a web page can't make
 * itself "the app" by claiming to be one, and code only the app needs is
 * dropped from the web bundle entirely.
 */
export const IS_ANDROID_APP = process.env.NEXT_PUBLIC_PLATFORM === "android";
