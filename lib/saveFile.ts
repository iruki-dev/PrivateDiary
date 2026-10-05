import { isNativeApp } from "@/lib/native/bridge";
import { saveFile } from "@/lib/native/app";

/**
 * Hands a text file to the person: a browser download on the web, and
 * Android's own "save as" sheet in the app (a WebView has no downloads
 * folder, and the app never writes files on its own — the person picks
 * where it goes). Resolves false if they backed out of the sheet.
 */
export async function saveTextFile(filename: string, mimeType: string, content: string): Promise<boolean> {
  if (isNativeApp()) {
    return saveFile(filename, mimeType.split(";")[0].trim(), content);
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking immediately can cancel the download in some browsers, so
  // this waits a turn — the object URL is scoped to this document and
  // goes away with the tab regardless.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
