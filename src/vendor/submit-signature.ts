import { createHmac } from "node:crypto";

/** Prime sequence used by the U校园 `primeSkip` key derivation. */
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43];

/**
 * U校园's `primeSkip` key derivation.
 *
 * Reproduces the front-end `V.primeSkip` function:
 *   offset = (offset + PRIMES[i % PRIMES.length]) % key.length
 *   bytes[i] = (key.charCodeAt(offset) + i) & 0xff
 */
export function primeSkip(key: string, length: number): Uint8Array {
  if (!key) throw new Error("primeSkip: empty key");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < length; index += 1) {
    offset = (offset + PRIMES[index % PRIMES.length]!) % key.length;
    bytes[index] = (key.charCodeAt(offset) + index) & 0xff;
  }
  return bytes;
}

/**
 * HOTP (RFC 4226) with HMAC-SHA1 and the front-end's 6-digit formatting.
 *
 * The front-end uses `String(truncated % modDivisor).padStart(6, "0")`.
 */
export function hotpSha1(
  key: Uint8Array,
  counter: number,
  modDivisor = 1_000_000,
): string {
  const buffer = Buffer.alloc(8);
  let value = BigInt(Math.floor(counter));
  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  const digest = createHmac("sha1", Buffer.from(key)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(code % modDivisor).padStart(6, "0");
}

export interface SubmitSignatureInput {
  /** Raw Authorization header value, including the `Bearer ` prefix. */
  authorization: string;
  /** U校园 openId (JWT `sub` / `boid`). */
  openId: string;
  /** Exam page URL used as `referer` and `x-referer`. */
  referer: string;
  /** Millisecond timestamp sent as payload `a` and `b`. */
  timestamp: number;
}

/**
 * Build the short-lived `v` header required by
 * `POST /api/reader/paper/answer/submitUserPaperAnswer`.
 *
 * Verified against a real captured request:
 *   authorization + referer + openId + timestamp 1793890353671 -> "016314"
 */
export function buildSubmitSignature(input: SubmitSignatureInput): string {
  const openIdSum = input.openId
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const keyLength = (openIdSum % 10) + 4;
  const keyString = `${input.authorization}|${input.referer}`;
  const keyBytes = primeSkip(keyString, keyLength);
  return hotpSha1(keyBytes, input.timestamp);
}

/** Decode a JWT payload without verifying the signature. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const raw = token.replace(/^Bearer\s+/i, "").trim();
  const parts = raw.split(".");
  if (parts.length < 2) throw new Error("not a JWT");
  const payload = parts[1]!;
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

/** Extract the U校园 openId from a reader JWT. */
export function readOpenId(token: string): string {
  const payload = decodeJwtPayload(token);
  const openId = payload.openId ?? payload.sub ?? payload.boid;
  if (typeof openId !== "string" || !openId) {
    throw new Error("reader token has no openId/sub/boid");
  }
  return openId;
}
