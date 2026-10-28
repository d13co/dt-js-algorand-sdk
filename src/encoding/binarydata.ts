import { isNode } from '../utils/utils.js';

/**
 * The bytes of a base64 string, without Node's `Buffer` (browsers). A loop
 * over `charCodeAt` is about 30 times faster than `Uint8Array.from` with a
 * callback. Exported for tests only: use {@link base64ToBytes}.
 */
export function base64ToBytesPortable(base64String: string): Uint8Array {
  /* eslint-env browser */
  const binString = atob(base64String);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

/** Bytes per `String.fromCharCode` call, well under engines' argument limits. */
const BASE64_CHUNK = 0x8000;

/**
 * The base64 string of some bytes, without Node's `Buffer` (browsers). It
 * builds the binary string in chunks with `String.fromCharCode`, about 5 times
 * faster than a string per byte. Exported for tests only: use
 * {@link bytesToBase64}.
 */
export function bytesToBase64Portable(byteArray: Uint8Array): string {
  /* eslint-env browser */
  let binString = '';
  for (let i = 0; i < byteArray.length; i += BASE64_CHUNK) {
    binString += String.fromCharCode.apply(
      null,
      byteArray.subarray(i, i + BASE64_CHUNK) as unknown as number[]
    );
  }
  return btoa(binString);
}

/**
 * Convert a base64 string to a Uint8Array for Node.js and browser environments.
 * @returns A Uint8Array
 */
export function base64ToBytes(base64String: string): Uint8Array {
  if (isNode()) {
    return new Uint8Array(Buffer.from(base64String, 'base64'));
  }
  return base64ToBytesPortable(base64String);
}

/**
 * Convert a Uint8Array to a base64 string for Node.js and browser environments.
 * @returns A base64 string
 */
export function bytesToBase64(byteArray: Uint8Array): string {
  if (isNode()) {
    return Buffer.from(byteArray).toString('base64');
  }
  return bytesToBase64Portable(byteArray);
}

/**
 * Convert a byte array to a UTF-8 string. Warning: not all byte arrays are valid UTF-8.
 * @returns A decoded string
 */
export function bytesToString(byteArray: Uint8Array): string {
  return new TextDecoder().decode(byteArray);
}

/**
 * Returns a Uint8Array given an input string or Uint8Array.
 * @returns A base64 string
 */
export function coerceToBytes(input: Uint8Array | string): Uint8Array {
  if (typeof input === 'string') {
    return new TextEncoder().encode(input);
  }
  return input;
}

/**
 * Convert a Uint8Array to a hex string for Node.js and browser environments.
 * @returns A hex string
 */
export function bytesToHex(byteArray: Uint8Array): string {
  if (isNode()) {
    return Buffer.from(byteArray).toString('hex');
  }
  return Array.from(byteArray)
    .map((i) => i.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert a hex string to Uint8Array for Node.js and browser environments.
 * @returns A Uint8Array
 */
export function hexToBytes(hexString: string): Uint8Array {
  if (isNode()) {
    return Buffer.from(hexString, 'hex');
  }
  let hex = hexString;
  if (hexString.length % 2 !== 0) {
    hex = hexString.padStart(1, '0');
  }
  const byteArray = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length / 2; i++) {
    byteArray[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  }
  return byteArray;
}
