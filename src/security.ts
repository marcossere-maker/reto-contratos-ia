import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Request } from "express";
import { CloudState, cloudEnabled } from "./cloud-state.js";

const localSecret = randomBytes(32).toString("hex");
const lifetime = 7 * 86400;
const secret = () => {
  if (cloudEnabled() && !process.env.STORAGE_ACCESS_TOKEN)
    throw new Error("Falta la credencial del servidor.");
  return process.env.STORAGE_ACCESS_TOKEN || localSecret;
};
const sign = (text: string) =>
  createHmac("sha256", secret()).update(text).digest("hex");
export const cookieName = () =>
  process.env.VERCEL ? "__Host-reto-visitor" : "reto-visitor";
export function issueVisitor(now = Date.now()) {
  const value = `${Math.floor(now / 1000)}.${randomBytes(32).toString("hex")}`;
  return `${value}.${sign(value)}`;
}
export function visitorId(value: string, now = Date.now()): string | null {
  const match = /^(\d{10})\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(value);
  if (!match) return null;
  const age = Math.floor(now / 1000) - Number(match[1]);
  if (age < 0 || age > lifetime) return null;
  if (
    !timingSafeEqual(
      Buffer.from(match[3], "hex"),
      Buffer.from(sign(`${match[1]}.${match[2]}`), "hex"),
    )
  )
    return null;
  return "v_" + createHash("sha256").update(value).digest("hex");
}
export function requestVisitor(req: Request) {
  const value = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName() + "="))
    ?.slice(cookieName().length + 1);
  return value ? visitorId(value) : null;
}
export const visitorCookie = (value: string) =>
  `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime}${process.env.VERCEL ? "; Secure" : ""}`;
export function ipBucket(req: Request) {
  // Vercel sobrescribe esta cabecera en su borde; no confiamos en XFF enviado al servidor local.
  const ip = process.env.VERCEL
    ? req.get("x-vercel-forwarded-for") || "unknown"
    : req.socket.remoteAddress || "local";
  return sign("ip:" + ip);
}
const rates = new Map<string, { window: number; hits: number }>();
export async function takeRate(bucket: string, limit: number, seconds: number) {
  if (cloudEnabled()) return new CloudState().takeRate(bucket, limit, seconds);
  const window = Math.floor(Date.now() / (seconds * 1000));
  const key = `${bucket}:${seconds}`;
  const previous = rates.get(key);
  const hits = previous?.window === window ? previous.hits + 1 : 1;
  rates.set(key, { window, hits });
  if (rates.size > 5000)
    for (const [key, value] of rates)
      if (value.window < window - 86400) rates.delete(key);
  return hits <= limit;
}
export const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
