import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aesGcm";
import {
  AES_GCM_IV_LENGTH,
  PBKDF2_HASH,
  PBKDF2_ITERATIONS,
  PBKDF2_SALT_LENGTH,
} from "./constants";
import { base64ToBytes, bytesToBase64 } from "./encoding";
import { WrongPassphraseError } from "./errors";
import { wipeBytes } from "./memory";
import { derivePbkdf2WrappingKey } from "./passphrase";

/**
 * "잠긴 파일로 내보내기": an export file (lib/entries/export.ts's JSON)
 * locked with a password the person chooses for the file. Same building
 * blocks as the passphrase-wrapped seed (passphrase.ts): PBKDF2-SHA-256
 * with the app's iteration count and a fresh random salt, then
 * AES-256-GCM.
 *
 * The header (format, version, KDF and cipher parameters) is the AAD, so
 * nothing in it can be changed — say, the iteration count lowered — without
 * the file failing to open. A wrong password and a damaged file fail the
 * same way (the GCM tag), reported as WrongPassphraseError, exactly as
 * unwrapSeed does.
 *
 * The file is independent of any account: its contents are plaintext
 * entries under its own key, so it can be brought into any diary — the
 * same account, a new one, or the Android app's local diary
 * (lib/entries/import.ts) — and re-encrypted there for that diary's keys.
 */

export const LOCKED_EXPORT_FORMAT = "privatediary-locked-export";
export const LOCKED_EXPORT_VERSION = 1;

/** Below this a locked file is refused rather than brute-force-friendly. */
const MIN_ITERATIONS = 600_000;
/** Above this, opening a file would freeze the page for minutes; a file asking for it isn't one we wrote. */
const MAX_ITERATIONS = 10_000_000;

export interface LockedExportHeader {
  format: typeof LOCKED_EXPORT_FORMAT;
  version: typeof LOCKED_EXPORT_VERSION;
  kdf: { name: "pbkdf2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "aes-256-gcm"; iv: string };
}

export interface LockedExportFile extends LockedExportHeader {
  ciphertext: string;
}

/** Fixed key order, so the AAD bytes are the same on both sides. */
function headerAad(header: LockedExportHeader): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({
      format: header.format,
      version: header.version,
      kdf: {
        name: header.kdf.name,
        hash: header.kdf.hash,
        iterations: header.kdf.iterations,
        salt: header.kdf.salt,
      },
      cipher: { name: header.cipher.name, iv: header.cipher.iv },
    })
  );
}

export async function lockExport(plaintext: string, password: string): Promise<LockedExportFile> {
  const salt = randomBytes(PBKDF2_SALT_LENGTH);
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const header: LockedExportHeader = {
    format: LOCKED_EXPORT_FORMAT,
    version: LOCKED_EXPORT_VERSION,
    kdf: { name: "pbkdf2", hash: PBKDF2_HASH, iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: "aes-256-gcm", iv: bytesToBase64(iv) },
  };
  const key = await derivePbkdf2WrappingKey(password, salt, PBKDF2_ITERATIONS);
  const body = utf8ToBytes(plaintext);
  const ciphertext = await aesGcmEncrypt(key, iv, body, headerAad(header));
  wipeBytes(key, body);
  return { ...header, ciphertext: bytesToBase64(ciphertext) };
}

/** True for anything shaped like a locked export (it may still fail to open). */
export function isLockedExport(value: unknown): value is LockedExportFile {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  const kdf = file.kdf as Record<string, unknown> | undefined;
  const cipher = file.cipher as Record<string, unknown> | undefined;
  return (
    file.format === LOCKED_EXPORT_FORMAT &&
    file.version === LOCKED_EXPORT_VERSION &&
    typeof file.ciphertext === "string" &&
    typeof kdf === "object" &&
    kdf !== null &&
    kdf.name === "pbkdf2" &&
    kdf.hash === "SHA-256" &&
    typeof kdf.iterations === "number" &&
    Number.isInteger(kdf.iterations) &&
    typeof kdf.salt === "string" &&
    typeof cipher === "object" &&
    cipher !== null &&
    cipher.name === "aes-256-gcm" &&
    typeof cipher.iv === "string"
  );
}

/** Opens a locked export. Throws WrongPassphraseError for a wrong password or a damaged file. */
export async function unlockExport(file: LockedExportFile, password: string): Promise<string> {
  const { iterations } = file.kdf;
  if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw new WrongPassphraseError();
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = base64ToBytes(file.kdf.salt);
    iv = base64ToBytes(file.cipher.iv);
    ciphertext = base64ToBytes(file.ciphertext);
  } catch {
    throw new WrongPassphraseError();
  }
  const key = await derivePbkdf2WrappingKey(password, salt, iterations);
  try {
    const body = await aesGcmDecrypt(key, iv, ciphertext, headerAad(file));
    const text = new TextDecoder().decode(body);
    wipeBytes(body);
    return text;
  } catch {
    throw new WrongPassphraseError();
  } finally {
    wipeBytes(key);
  }
}
