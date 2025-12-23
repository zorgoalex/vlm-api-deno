/**
 * Auth types for JWT validation and permissions.
 */

/**
 * JWT claims from Auth0 access token.
 */
export interface JwtClaims {
  /** Issuer (Auth0 tenant URL) */
  iss: string;
  /** Subject (user ID) */
  sub: string;
  /** Audience (API identifier) */
  aud: string | string[];
  /** Expiration time (Unix timestamp) */
  exp: number;
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Permissions array (Auth0 RBAC) */
  permissions?: string[];
  /** Scopes string (OAuth2 standard) */
  scope?: string;
  /** Azure AD object ID (if applicable) */
  azp?: string;
}

/**
 * Auth context passed to route handlers.
 */
export interface AuthContext {
  /** Whether request is authenticated */
  authenticated: boolean;
  /** JWT claims (if authenticated via JWT) */
  claims?: JwtClaims;
  /** User ID from claims.sub */
  userId?: string;
  /** Permissions from claims */
  permissions: string[];
  /** Auth method used */
  method: "jwt" | "legacy" | "none";
}

/**
 * Auth error codes.
 */
export type AuthErrorCode =
  | "AUTH_MISSING"
  | "AUTH_INVALID_FORMAT"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_EXPIRED"
  | "AUTH_ISSUER_MISMATCH"
  | "AUTH_AUDIENCE_MISMATCH"
  | "AUTH_INSUFFICIENT_PERMISSIONS"
  | "AUTH_CONFIG_ERROR";

/**
 * Auth error with code and message.
 */
export interface AuthError {
  code: AuthErrorCode;
  message: string;
  status: 401 | 403 | 500;
}

/**
 * Result of auth validation.
 */
export type AuthResult =
  | { ok: true; context: AuthContext }
  | { ok: false; error: AuthError };

/**
 * Route auth configuration.
 */
export interface RouteAuthConfig {
  /** Route is public (no auth required) */
  public?: boolean;
  /** Required permission(s) - any of these grants access */
  permissions?: string[];
  /** Allow legacy X-Admin-Token fallback */
  legacyAllowed?: boolean;
}
