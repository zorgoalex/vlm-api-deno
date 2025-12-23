/**
 * Auth middleware for request authorization.
 */

import type { AuthResult, AuthContext, RouteAuthConfig } from "./types.ts";
import {
  extractBearerToken,
  validateJwt,
  isAuthRequired,
  isLegacyAllowed,
  getAuthConfig,
} from "./jwt.ts";
import { getRouteConfig, hasPermission, getPermissions } from "./permissions.ts";

/**
 * Check legacy admin token.
 */
function checkLegacyToken(req: Request): boolean {
  const adminToken = Deno.env.get("ADMIN_TOKEN");
  if (!adminToken) return false;

  const providedToken = req.headers.get("X-Admin-Token");
  return providedToken === adminToken;
}

/**
 * Create unauthenticated context.
 */
function unauthenticatedContext(): AuthContext {
  return {
    authenticated: false,
    permissions: [],
    method: "none",
  };
}

/**
 * Main auth middleware.
 * Validates request and returns AuthResult.
 *
 * Priority:
 * 1. Public route → allow
 * 2. Bearer token → JWT validation + permissions check
 * 3. X-Admin-Token + legacyAllowed → legacy check
 * 4. No auth + AUTH_REQUIRED=0 → allow (dev mode)
 * 5. Otherwise → 401
 */
export async function authMiddleware(
  req: Request,
  method: string,
  pathname: string
): Promise<AuthResult> {
  // Get route config
  const routeConfig = getRouteConfig(method, pathname);

  // 1. Public route - no auth needed
  if (routeConfig?.public) {
    return {
      ok: true,
      context: unauthenticatedContext(),
    };
  }

  // Try Bearer token first
  const bearerToken = extractBearerToken(req);

  if (bearerToken) {
    // 2. Validate JWT
    const jwtResult = await validateJwt(bearerToken);

    if (!jwtResult.ok) {
      return { ok: false, error: jwtResult.error };
    }

    const claims = jwtResult.claims;
    const permissions = getPermissions(claims);

    // Check permissions if required
    if (routeConfig?.permissions && routeConfig.permissions.length > 0) {
      if (!hasPermission(claims, routeConfig.permissions)) {
        return {
          ok: false,
          error: {
            code: "AUTH_INSUFFICIENT_PERMISSIONS",
            message: "Insufficient permissions",
            status: 403,
          },
        };
      }
    }

    // Success with JWT
    return {
      ok: true,
      context: {
        authenticated: true,
        claims,
        userId: claims.sub,
        permissions,
        method: "jwt",
      },
    };
  }

  // 3. Try legacy token if allowed
  if (routeConfig?.legacyAllowed && isLegacyAllowed()) {
    if (checkLegacyToken(req)) {
      return {
        ok: true,
        context: {
          authenticated: true,
          permissions: ["write:prompts"], // Legacy token has write:prompts
          method: "legacy",
        },
      };
    }
  }

  // 4. Dev mode bypass
  if (!isAuthRequired()) {
    return {
      ok: true,
      context: unauthenticatedContext(),
    };
  }

  // 5. Check if auth config exists
  const config = getAuthConfig();
  if (!config) {
    // Auth required but not configured
    return {
      ok: false,
      error: {
        code: "AUTH_CONFIG_ERROR",
        message: "Authentication not configured",
        status: 500,
      },
    };
  }

  // 6. No valid auth provided
  return {
    ok: false,
    error: {
      code: "AUTH_MISSING",
      message: "Authorization required",
      status: 401,
    },
  };
}

/**
 * Re-export for convenience.
 */
export { getRouteConfig } from "./permissions.ts";
export type { AuthContext, AuthResult, RouteAuthConfig } from "./types.ts";
