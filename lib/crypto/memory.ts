/**
 * Best-effort secret wiping. JS/JIT gives no hard guarantee a zeroed buffer is
 * actually scrubbed from physical memory, but this still removes the value
 * from the one JS-visible reference we control once a key/seed is no longer
 * needed (ARCHITECTURE.md rule 6: derive, use, discard).
 */
export function wipeBytes(...arrays: Uint8Array[]): void {
  for (const array of arrays) {
    array.fill(0);
  }
}
