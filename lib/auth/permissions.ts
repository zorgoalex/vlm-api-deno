/**
 * Permissions checking and route configuration.
 */

import type { JwtClaims, RouteAuthConfig } from "./types.ts";

/**
 * Permission constants.
 */
export const PERMISSIONS = {
  READ_VISION: "read:vision",
  READ_PROMPTS: "read:prompts",
  WRITE_PROMPTS: "write:prompts",
  WRITE_IMAGES: "write:images",
} as const;

/**
 * Route permissions matrix.
 * Key format: "METHOD /path" or "METHOD /path/:param"
 */
export const ROUTE_PERMISSIONS: Record<string, RouteAuthConfig> = {
  // Health endpoints - public
  "GET /healthz": { public: true },
  "GET /readyz": { public: true },

  // Vision API
  "POST /v1/vision/analyze": { permissions: [PERMISSIONS.READ_VISION] },
  "POST /v1/vision/stream": { public: true }, // Temporarily open (SSE deferred)

  // Images API
  "POST /v1/images/upload": { permissions: [PERMISSIONS.WRITE_IMAGES] },

  // Prompts API - read
  "GET /v1/prompts": { permissions: [PERMISSIONS.READ_PROMPTS] },
  "GET /v1/prompts/:id": { permissions: [PERMISSIONS.READ_PROMPTS] },
  "GET /v1/prompts/default": { permissions: [PERMISSIONS.READ_PROMPTS] },

  // Prompts API - write (with legacy fallback)
  "POST /v1/prompts": {
    permissions: [PERMISSIONS.WRITE_PROMPTS],
    legacyAllowed: true,
  },
  "PUT /v1/prompts/:id": {
    permissions: [PERMISSIONS.WRITE_PROMPTS],
    legacyAllowed: true,
  },
  "DELETE /v1/prompts/:id": {
    permissions: [PERMISSIONS.WRITE_PROMPTS],
    legacyAllowed: true,
  },
  "PUT /v1/prompts/:id/default": {
    permissions: [PERMISSIONS.WRITE_PROMPTS],
    legacyAllowed: true,
  },

  // Admin endpoints
  "POST /admin/prompts/defaults/sync": {
    permissions: [PERMISSIONS.WRITE_PROMPTS],
    legacyAllowed: true,
  },
};

/**
 * Normalize route path for lookup.
 * Replaces dynamic segments with :param placeholder.
 */
export function normalizeRoutePath(pathname: string): string {
  // Replace UUID-like segments with :id
  // UUID format: 8-4-4-4-12 hex chars
  const uuidPattern = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  let normalized = pathname.replace(uuidPattern, "/:id");

  // Replace any remaining numeric or alphanumeric ID segments
  // But preserve known static paths like "default", "sync"
  const staticPaths = new Set(["default", "sync", "analyze", "stream", "upload", "prompts", "vision", "images", "admin", "v1", "healthz", "readyz"]);

  const parts = normalized.split("/");
  normalized = parts
    .map((part, idx) => {
      if (part === "") return part;
      if (staticPaths.has(part.toLowerCase())) return part;
      // If it looks like an ID (long alphanumeric), replace with :id
      if (idx > 0 && /^[a-zA-Z0-9_-]{10,}$/.test(part)) {
        return ":id";
      }
      return part;
    })
    .join("/");

  return normalized;
}

/**
 * Get route auth config.
 * Returns undefined if route is not in the matrix (default: require auth).
 */
export function getRouteConfig(method: string, pathname: string): RouteAuthConfig | undefined {
  const normalizedPath = normalizeRoutePath(pathname);
  const key = `${method.toUpperCase()} ${normalizedPath}`;
  return ROUTE_PERMISSIONS[key];
}

/**
 * Check if claims have required permission.
 * Returns true if any of the required permissions is present.
 */
export function hasPermission(claims: JwtClaims, required: string | string[]): boolean {
  const permissions = claims.permissions;
  if (!Array.isArray(permissions)) return false;

  const requiredArray = Array.isArray(required) ? required : [required];
  return requiredArray.some((perm) => permissions.includes(perm));
}

/**
 * Check if claims have all required permissions.
 */
export function hasAllPermissions(claims: JwtClaims, required: string[]): boolean {
  const permissions = claims.permissions;
  if (!Array.isArray(permissions)) return false;

  return required.every((perm) => permissions.includes(perm));
}

/**
 * Get permissions from claims.
 */
export function getPermissions(claims: JwtClaims): string[] {
  return Array.isArray(claims.permissions) ? claims.permissions : [];
}
