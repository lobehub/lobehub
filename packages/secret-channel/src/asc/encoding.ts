const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export const utf8Encode = (value: string): Uint8Array => textEncoder.encode(value);
export const utf8Decode = (bytes: Uint8Array): string => textDecoder.decode(bytes);

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LOOKUP = new Map([...B64_ALPHABET].map((char, index) => [char, index]));

/** RFC 4648 §5 base64url without padding. Local implementation: identical in browsers, Node, Bun. */
export const toBase64Url = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63];
    out += B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63];
  }
  return out;
};

export const fromBase64Url = (value: string): Uint8Array => {
  if (value.length % 4 === 1) throw new TypeError('invalid base64url length');
  const out = new Uint8Array(Math.floor((value.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const char of value) {
    const index = B64_LOOKUP.get(char);
    if (index === undefined) throw new TypeError('invalid base64url character');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
};

export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

export const u32be = (value: number): Uint8Array => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
};

/** Length-prefixed (u32 big-endian) field list (spec §6.4): unambiguous, no delimiters or escaping. */
export const encodeFields = (fields: string[]): Uint8Array =>
  concatBytes(
    u32be(fields.length),
    ...fields.flatMap((field) => {
      const bytes = utf8Encode(field);
      return [u32be(bytes.length), bytes];
    }),
  );

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

/** Best-effort zeroisation of a buffer we own. JS gives no hard guarantee (GC copies, strings). */
export const wipe = (bytes: Uint8Array | undefined | null) => {
  bytes?.fill(0);
};

export const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export const fromHex = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || /[^\da-f]/i.test(hex)) throw new TypeError('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
