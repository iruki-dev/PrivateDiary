import {
  ENTRY_LENGTH_PREFIX_BYTES,
  MIN_PADDED_ENTRY_LENGTH,
} from "./constants";

/**
 * Length padding for entry plaintext (ARCHITECTURE.md §3.15).
 *
 * THE LEAK THIS CLOSES. AES-GCM is a stream cipher mode: it adds a 16-byte
 * tag and nothing else, so |ciphertext| = |plaintext| + 16, exactly.
 * Everything else in this design keeps the server from learning what you
 * wrote, but the size of each `entries.ciphertext` — which anyone with
 * database access can read off without any key — told them how MUCH you
 * wrote, to the byte. Combined with `createdAt`, which is a plaintext
 * field by necessity, that is a real signal: a run of two-word entries
 * after months of long ones says something about the writer that the
 * encryption was supposed to be protecting.
 *
 * THE SCHEME. Plaintext is wrapped in a record and padded with zeros to a
 * bucketed length:
 *
 *     [ 4-byte big-endian length ][ UTF-8 plaintext ][ 0x00 ... ]
 *
 * The length prefix makes unpadding exact and unambiguous, and it is
 * inside the AEAD, so it is authenticated along with everything else — a
 * corrupted length is a tamper signal, not a parsing hazard. Zero padding
 * is safe here for the same reason: it is encrypted under a per-entry
 * random 256-bit key, so known plaintext buys an attacker nothing.
 *
 * Bucketing is Padmé (Nikitin et al., "Reducing Metadata Leakage from
 * Encrypted Files and Communication with PURBs", PETS 2019). It rounds a
 * length up so the result keeps only its top few significant bits,
 * capping leakage at O(log log n) bits while costing at most ~12% storage
 * — far better than the ~100% worst case of rounding to powers of two,
 * and far more private than a fixed block size, which leaks the length
 * almost exactly once entries get long.
 *
 * Below MIN_PADDED_ENTRY_LENGTH everything pads to that one size, because
 * Padmé's buckets get very fine for small inputs (a 10-byte input rounds
 * to 10) and short entries are exactly where length is most revealing.
 *
 * Pure arithmetic, no crypto: this module only reshapes bytes, and
 * entry.ts does the encrypting.
 */

/**
 * floor(log2(value)) for value >= 1, computed exactly.
 *
 * Math.log2 would be the obvious choice but is floating point, and this
 * result decides a bucket boundary — an off-by-one at an exact power of
 * two would silently change the padded size for a whole class of entries.
 * Math.clz32 is exact for the 32-bit range, which entry sizes are far
 * inside (firestore.rules caps a stored entry well under 1 MB).
 */
function floorLog2(value: number): number {
  return 31 - Math.clz32(value);
}

/**
 * The padded size for a record of `length` bytes: Padmé, with a floor.
 * Exported for the tests and for the documentation to be checkable.
 */
export function paddedEntryLength(length: number): number {
  const target = Math.max(length, MIN_PADDED_ENTRY_LENGTH);
  const exponent = floorLog2(target);
  // Bits kept for the mantissa; the rest are zeroed by rounding up.
  const significantBits = floorLog2(exponent) + 1;
  const bucketBits = exponent - significantBits;
  if (bucketBits <= 0) return target;
  // Arithmetic rather than a bitmask: `&` coerces to int32, and while
  // today's sizes are nowhere near that, a size limit is exactly the kind
  // of constant that gets raised later.
  const bucket = 2 ** bucketBits;
  return Math.ceil(target / bucket) * bucket;
}

/** Wraps and pads `plaintext` into the record described above. */
export function padEntryPlaintext(plaintext: Uint8Array): Uint8Array {
  const recordLength = ENTRY_LENGTH_PREFIX_BYTES + plaintext.length;
  const record = new Uint8Array(paddedEntryLength(recordLength));
  new DataView(record.buffer).setUint32(0, plaintext.length, false);
  record.set(plaintext, ENTRY_LENGTH_PREFIX_BYTES);
  return record;
}

/**
 * Recovers the plaintext from a padded record.
 *
 * Throws RangeError on a length that doesn't fit the record. That can only
 * happen if the AEAD already accepted the ciphertext (so the bytes are
 * authentic) yet the contents are nonsense — meaning the entry was written
 * by something that is not this code. entry.ts turns it into a
 * TamperedCiphertextError, which is the accurate thing to tell the user.
 */
export function unpadEntryPlaintext(record: Uint8Array): Uint8Array {
  if (record.length < ENTRY_LENGTH_PREFIX_BYTES) {
    throw new RangeError("Padded entry record is shorter than its length prefix");
  }
  const length = new DataView(record.buffer, record.byteOffset, record.byteLength).getUint32(
    0,
    false
  );
  if (length > record.length - ENTRY_LENGTH_PREFIX_BYTES) {
    throw new RangeError("Padded entry record claims more content than it holds");
  }
  return record.slice(ENTRY_LENGTH_PREFIX_BYTES, ENTRY_LENGTH_PREFIX_BYTES + length);
}
