import sodium from "libsodium-wrappers-sumo";

/**
 * Thin wrappers over libsodium's encoding helpers. Callers must have awaited
 * sodium.ready (all public functions in this package do).
 */

export function toBase64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export function fromBase64(value: string): Uint8Array {
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}

export function toHex(bytes: Uint8Array): string {
  return sodium.to_hex(bytes);
}

export function utf8ToBytes(value: string): Uint8Array {
  return sodium.from_string(value);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return sodium.to_string(bytes);
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function splitBytes(buf: Uint8Array, at: number): [Uint8Array, Uint8Array] {
  return [buf.subarray(0, at), buf.subarray(at)];
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return sodium.memcmp(a, b);
}
