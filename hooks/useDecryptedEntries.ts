"use client";

import { useEffect, useState } from "react";
import { decryptEntry, type HybridPrivateKeys } from "@/lib/crypto";
import type { StoredEntry } from "@/lib/firebase/entries";
import { assertNativeIntegrity, EnvironmentTamperedError } from "@/lib/security/nativeIntegrity";

/**
 * Decrypts a list of entries INCREMENTALLY, newest first.
 *
 * The read path (ARCHITECTURE.md §3.3) does real work per entry — an
 * X25519 ECDH, an ML-KEM-768 decapsulation, an HKDF and two AES-GCM opens —
 * and all of it is synchronous JavaScript on the main thread. Decrypting
 * the whole archive before rendering anything, as this page originally did,
 * means a diary with a few hundred entries shows a spinner for seconds with
 * the UI frozen behind it, and every additional entry makes it worse
 * forever. Since entries arrive newest-first and that is also the order
 * they're read in, decrypting in small chunks and yielding to the browser
 * between them puts the entries someone actually wants on screen almost
 * immediately while the tail keeps working in the background.
 *
 * Failures are per-entry: one tampered or corrupt ciphertext surfaces on
 * its own card (§3.4 — a decrypt failure IS the tamper signal) and the rest
 * of the diary still opens. Two distinct failure sources, both per-entry:
 *
 *   - `entry.payload === null` — lib/firebase/entries.ts's listEntries()
 *     couldn't even DECODE this entry's stored base64 fields (security-
 *     patch-v2 / H2). There's no ciphertext to hand decryptEntry in the
 *     first place, so this is checked before attempting decryption, with
 *     its own message distinct from a real TamperedCiphertextError.
 *   - decryptEntry() itself throwing (a genuine AEAD/tamper failure).
 *
 * lib/security/nativeIntegrity.ts's assertNativeIntegrity() is checked
 * ONCE before decrypting anything, not per-entry: a tampered environment
 * (monkey-patched Web Crypto — see that module's doc comment) could be
 * reading every plaintext this loop produces regardless of what this hook
 * does with the result, so the whole batch refuses to even start rather
 * than handing plaintext to a compromised page.
 */

const CHUNK_SIZE = 6;

export const DECRYPT_ERROR_MESSAGE = "복호화 실패 — 암호문이 변조되었을 수 있습니다.";
export const CORRUPT_PAYLOAD_ERROR_MESSAGE = "손상된 항목 — 저장된 데이터를 읽을 수 없습니다.";
export const ENVIRONMENT_TAMPERED_ERROR_MESSAGE =
  "브라우저 환경이 변조된 것으로 감지되어 복호화를 중단했습니다.";

export interface DecryptionProgress {
  plaintexts: Record<string, string>;
  errors: Record<string, string>;
  /** How many entries have been attempted so far. */
  decryptedCount: number;
  total: number;
  done: boolean;
}

interface DecryptionState {
  /** Which entries array (by reference) the results below belong to. */
  source: readonly StoredEntry[] | null;
  plaintexts: Record<string, string>;
  errors: Record<string, string>;
  decryptedCount: number;
}

const EMPTY: DecryptionState = { source: null, plaintexts: {}, errors: {}, decryptedCount: 0 };

/** Lets the browser paint (and handle input) between chunks. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function useDecryptedEntries(
  privateKeys: HybridPrivateKeys | null,
  entries: readonly StoredEntry[]
): DecryptionProgress {
  const [state, setState] = useState<DecryptionState>(EMPTY);

  useEffect(() => {
    if (!privateKeys || entries.length === 0) return;
    let cancelled = false;

    (async () => {
      const plaintexts: Record<string, string> = {};
      const errors: Record<string, string> = {};

      try {
        assertNativeIntegrity();
      } catch (err) {
        if (!cancelled && err instanceof EnvironmentTamperedError) {
          setState({
            source: entries,
            plaintexts: {},
            errors: Object.fromEntries(
              entries.map((entry) => [entry.id, ENVIRONMENT_TAMPERED_ERROR_MESSAGE])
            ),
            decryptedCount: entries.length,
          });
        }
        return;
      }

      for (let offset = 0; offset < entries.length; offset += CHUNK_SIZE) {
        for (const entry of entries.slice(offset, offset + CHUNK_SIZE)) {
          if (!entry.payload) {
            errors[entry.id] = CORRUPT_PAYLOAD_ERROR_MESSAGE;
            continue;
          }
          try {
            plaintexts[entry.id] = await decryptEntry(privateKeys, entry.payload);
          } catch {
            errors[entry.id] = DECRYPT_ERROR_MESSAGE;
          }
        }
        if (cancelled) return;
        // Copies, not the accumulators themselves: handing React the same
        // mutable object every chunk would make the identity check in
        // consumers (and any memo downstream) see no change.
        setState({
          source: entries,
          plaintexts: { ...plaintexts },
          errors: { ...errors },
          decryptedCount: Math.min(offset + CHUNK_SIZE, entries.length),
        });
        await yieldToBrowser();
        if (cancelled) return;
      }
    })();

    return () => {
      cancelled = true;
    };
    // `entries` is depended on by reference on purpose: lib/firebase's
    // listEntries returns a fresh array per fetch, and re-running on a
    // remount-with-the-same-data is what keeps a navigated-back-to page
    // from rendering permanently blank cards.
  }, [privateKeys, entries]);

  // Results for a PREVIOUS entries array must never be shown against the
  // current one — deriving this rather than resetting state inside the
  // effect avoids both a stale first paint and an extra render.
  const current = state.source === entries ? state : EMPTY;

  return {
    plaintexts: current.plaintexts,
    errors: current.errors,
    decryptedCount: current.decryptedCount,
    total: entries.length,
    done: !privateKeys || entries.length === 0 || current.decryptedCount >= entries.length,
  };
}
