/**
 * JWT validation for Auth0 access tokens.
 */

import { jwtVerify, errors } from "jose";
import { getJwksClient } from "./jwks.ts";
import type { JwtClaims, AuthError } from "./types.ts";

/** Clock tolerance for exp/iat validation (seconds) */
const CLOCK_TOLERANCE = 60;

/**
 * Auth config from environment.
 */
export interface AuthConfig {
  issuer: string;
  audience: string;
}

/**
 * Get auth config from environment.
 * Returns null if not configured.
 */
export function getAuthConfig(): AuthConfig | null {
  const issuer = Deno.env.get("AUTH0_ISSUER_BASE_URL");
  const audience = Deno.env.get("AUTH0_AUDIENCE");

  if (!issuer || !audience) {
    return null;
  }

  return { issuer, audience };
}

/**
 * Check if auth is required.
 */
export function isAuthRequired(): boolean {
  const required = Deno.env.get("AUTH_REQUIRED");
  // Default to true if not set
  return required !== "0";
}

/**
 * Check if legacy tokens are allowed.
 */
export function isLegacyAllowed(): boolean {
  const allowed = Deno.env.get("ALLOW_LEGACY_TOKENS");
  return allowed === "1";
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1];
}

/**
 * Result of JWT validation.
 */
export type JwtValidationResult =
  | { ok: true; claims: JwtClaims }
  | { ok: false; error: AuthError };

/**
 * Validate JWT token.
 * Checks signature (via JWKS), issuer, audience, and expiration.
 */
export async function validateJwt(token: string): Promise<JwtValidationResult> {
  const config = getAuthConfig();

  if (!config) {
    return {
      ok: false,
      error: {
        code: "AUTH_CONFIG_ERROR",
        message: "Auth0 configuration missing",
        status: 500,
      },
    };
  }

  try {
    const jwks = getJwksClient(config.issuer);

    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: CLOCK_TOLERANCE,
    });

    // Cast payload to JwtClaims
    const claims: JwtClaims = {
      iss: payload.iss as string,
      sub: payload.sub as string,
      aud: payload.aud as string | string[],
      exp: payload.exp as number,
      iat: payload.iat as number,
      permissions: payload.permissions as string[] | undefined,
      scope: payload.scope as string | undefined,
      azp: payload.azp as string | undefined,
    };

    return { ok: true, claims };
  } catch (err) {
    return { ok: false, error: mapJwtError(err) };
  }
}

/**
 * Map jose errors to AuthError.
 */
function mapJwtError(err: unknown): AuthError {
  if (err instanceof errors.JWTExpired) {
    return {
      code: "AUTH_EXPIRED",
      message: "Token has expired",
      status: 401,
    };
  }

  if (err instanceof errors.JWTClaimValidationFailed) {
    const message = err.message.toLowerCase();

    if (message.includes("iss") || message.includes("issuer")) {
      return {
        code: "AUTH_ISSUER_MISMATCH",
        message: "Invalid token issuer",
        status: 401,
      };
    }

    if (message.includes("aud") || message.includes("audience")) {
      return {
        code: "AUTH_AUDIENCE_MISMATCH",
        message: "Invalid token audience",
        status: 401,
      };
    }

    return {
      code: "AUTH_INVALID_TOKEN",
      message: "Token validation failed",
      status: 401,
    };
  }

  if (err instanceof errors.JWSSignatureVerificationFailed) {
    return {
      code: "AUTH_INVALID_TOKEN",
      message: "Invalid token signature",
      status: 401,
    };
  }

  if (err instanceof errors.JWSInvalid || err instanceof errors.JWTInvalid) {
    return {
      code: "AUTH_INVALID_TOKEN",
      message: "Malformed token",
      status: 401,
    };
  }

  // Network errors fetching JWKS
  if (err instanceof TypeError && (err as Error).message?.includes("fetch")) {
    return {
      code: "AUTH_CONFIG_ERROR",
      message: "Failed to fetch signing keys",
      status: 500,
    };
  }

  // Unknown error
  console.error("[auth] Unexpected JWT validation error:", err);
  return {
    code: "AUTH_INVALID_TOKEN",
    message: "Token validation failed",
    status: 401,
  };
}
