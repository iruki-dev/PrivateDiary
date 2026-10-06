import { isNativeApp, NativeError } from "@/lib/native/bridge";
import { openTextFile as openNativeTextFile } from "@/lib/native/app";

/**
 * Asks the person for one text file (an export to bring back in) and
 * returns its contents: the browser's file picker on the web, Android's
 * document picker in the app (the WebView has no file picker of its own;
 * MainActivity reads the chosen file). Resolves null if they backed out.
 */
export class FileTooLargeError extends Error {
  constructor() {
    super("The file is too large.");
    this.name = "FileTooLargeError";
  }
}

const MAX_BYTES = 32 * 1024 * 1024;

export async function pickTextFile(accept = ".json,application/json"): Promise<{ name: string | null; content: string } | null> {
  if (isNativeApp()) {
    try {
      return await openNativeTextFile();
    } catch (err) {
      if (err instanceof NativeError && err.code === "cancelled") return null;
      if (err instanceof NativeError && err.code === "too-large") throw new FileTooLargeError();
      throw err;
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      if (file.size > MAX_BYTES) {
        reject(new FileTooLargeError());
        return;
      }
      file.text().then((content) => resolve({ name: file.name, content }), reject);
    });
    // Browsers that report closing the picker without a choice.
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
