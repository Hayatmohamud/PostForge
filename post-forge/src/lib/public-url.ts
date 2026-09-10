import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "./errors";

export type ResolveHostname = (hostname: string) => Promise<readonly string[]>;

export const resolveHostname: ResolveHostname = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

function ipv4Bytes(value: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const bytes = value.split(".").map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : null;
}

function ipv6Bytes(value: string): number[] | null {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  const [left, right, ...extra] = normalized.split("::");
  if (extra.length) return null;
  const parse = (part: string): number[] => part ? part.split(":").flatMap((word) => {
    if (word.includes(".")) {
      const bytes = ipv4Bytes(word);
      return bytes ? [bytes[0] * 256 + bytes[1], bytes[2] * 256 + bytes[3]] : [];
    }
    return /^[0-9a-f]{1,4}$/.test(word) ? [Number.parseInt(word, 16)] : [];
  }) : [];
  const leftWords = parse(left);
  const rightWords = parse(right);
  if (leftWords.length + rightWords.length > 8) return null;
  const words = normalized.includes("::") ? [...leftWords, ...Array(8 - leftWords.length - rightWords.length).fill(0), ...rightWords] : leftWords;
  return words.length === 8 ? words.flatMap((word) => [word >> 8, word & 255]) : null;
}

function isPrivateIpv4(bytes: number[]): boolean {
  const [a, b] = bytes;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) || (a === 198 && b >= 18 && b <= 19) ||
    (a === 203 && b === 0) || a >= 224;
}

export function isPrivateAddress(value: string): boolean {
  const address = value.replace(/^\[|\]$/g, "");
  const v4 = ipv4Bytes(address);
  if (v4) return isPrivateIpv4(v4);
  if (isIP(address) !== 6) return true;
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const first = bytes[0];
  const isMapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 255 && bytes[11] === 255;
  return isMapped ? isPrivateIpv4(bytes.slice(12)) : first === 0 || (first & 0xfe) === 0xfc || (first >= 0xfe && first <= 0xff) ||
    (first === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8);
}

function isBlockedHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/\.$/, "");
  return value === "localhost" || value.endsWith(".localhost") || value === "local" || value.endsWith(".local");
}

export function parsePublicUrl(value: unknown): URL {
  if (typeof value !== "string") throw new AppError("INVALID_INPUT");
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError("INVALID_INPUT"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || isBlockedHostname(url.hostname)) {
    throw new AppError("INVALID_INPUT");
  }
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && isPrivateAddress(url.hostname)) throw new AppError("INVALID_INPUT");
  return url;
}

export async function validatePublicUrl(value: unknown, resolver: ResolveHostname = resolveHostname): Promise<URL> {
  const url = parsePublicUrl(value);
  let addresses: readonly string[];
  try { addresses = isIP(url.hostname.replace(/^\[|\]$/g, "")) ? [url.hostname] : await resolver(url.hostname); } catch { throw new AppError("INVALID_INPUT"); }
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new AppError("INVALID_INPUT");
  return url;
}
