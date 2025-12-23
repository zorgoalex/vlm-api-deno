/**
 * JWKS (JSON Web Key Set) client for Auth0.
 * Uses jose library with built-in caching.
 */

import { createRemoteJWKSet } from "jose";
import type { JWTVerifyGetKey } from "jose";

let cachedJwks: JWTVerifyGetKey | null = null;
let cachedIssuer: string | null = null;

/**
 * Get JWKS URL from issuer.
 * Auth0 standard: {issuer}/.well-known/jwks.json
 */
export function getJwksUrl(issuer: string): string {
  const customUrl = Deno.env.get("AUTH0_JWKS_URL");
  if (customUrl) return customUrl;

  // Ensure issuer ends with /
  const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return `${base}.well-known/jwks.json`;
}

/**
 * Get or create JWKS client.
 * Caches the client for the same issuer.
 * jose.createRemoteJWKSet handles key caching internally.
 */
export function getJwksClient(issuer: string): JWTVerifyGetKey {
  // Return cached if issuer matches
  if (cachedJwks && cachedIssuer === issuer) {
    return cachedJwks;
  }

  const jwksUrl = getJwksUrl(issuer);

  // createRemoteJWKSet fetches and caches keys automatically
  // Default cache TTL is ~10 minutes, refreshes on key rotation
  cachedJwks = createRemoteJWKSet(new URL(jwksUrl), {
    // Optional: custom cache settings
    // cacheMaxAge: 600000, // 10 minutes in ms
  });
  cachedIssuer = issuer;

  return cachedJwks;
}

/**
 * Clear JWKS cache (for testing or key rotation).
 */
export function clearJwksCache(): void {
  cachedJwks = null;
  cachedIssuer = null;
}
