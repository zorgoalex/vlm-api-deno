type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
};

function getR2Config(): R2Config {
  const accountId = Deno.env.get("R2_ACCOUNT_ID")?.trim();
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID")?.trim();
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY")?.trim();
  const bucket = Deno.env.get("R2_BUCKET")?.trim();
  const publicBaseUrl = Deno.env.get("R2_PUBLIC_BASE_URL")?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 config missing (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)",
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

function toHexBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return toHexBytes(new Uint8Array(digest));
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function amzDate(date = new Date()): { amz: string; ymd: string } {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  const ymd = `${y}${m}${d}`;
  return { ymd, amz: `${ymd}T${hh}${mm}${ss}Z` };
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function encodePath(path: string): string {
  return path.split("/").map((seg) => encodeRfc3986(seg)).join("/");
}

async function deriveSigningKey(secretAccessKey: string, ymd: string): Promise<Uint8Array> {
  const kDate = await hmacSha256(new TextEncoder().encode("AWS4" + secretAccessKey), ymd);
  const kRegion = await hmacSha256(kDate, "auto");
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  return kSigning;
}

export async function putObjectToR2(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<{ key: string; etag?: string }> {
  const cfg = getR2Config();
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const now = amzDate();
  const method = "PUT";
  const canonicalUri = encodePath(`/${cfg.bucket}/${key}`);
  const url = `https://${host}${canonicalUri}`;

  const payloadHash = await sha256Hex(body);
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${now.amz}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${now.ymd}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now.amz,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(cfg.secretAccessKey, now.ymd);
  const signature = toHexBytes(await hmacSha256(signingKey, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": contentType,
      "Authorization": authorization,
      "X-Amz-Date": now.amz,
      "X-Amz-Content-Sha256": payloadHash,
    },
    body,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`R2 PUT error (${res.status}): ${errorText}`);
  }

  return { key, etag: res.headers.get("ETag") ?? undefined };
}

export async function presignGetObjectUrl(
  key: string,
  expiresInSec: number,
): Promise<{ url: string; expiresInSec: number }> {
  const cfg = getR2Config();
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const now = amzDate();
  const method = "GET";
  const canonicalUri = encodePath(`/${cfg.bucket}/${key}`);

  const clampedExpires = Math.max(1, Math.min(604800, Math.floor(expiresInSec)));
  const scope = `${now.ymd}/auto/s3/aws4_request`;
  const credential = `${cfg.accessKeyId}/${scope}`;

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": now.amz,
    "X-Amz-Expires": String(clampedExpires),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQuery = Object.keys(query).sort().map((k) =>
    `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`
  ).join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now.amz,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(cfg.secretAccessKey, now.ymd);
  const signature = toHexBytes(await hmacSha256(signingKey, stringToSign));

  const url = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return { url, expiresInSec: clampedExpires };
}

export function getPublicObjectUrl(key: string): string | null {
  const cfg = getR2Config();
  if (!cfg.publicBaseUrl) return null;
  const base = cfg.publicBaseUrl.replace(/\/+$/, "");
  return `${base}/${encodePath(key)}`;
}
