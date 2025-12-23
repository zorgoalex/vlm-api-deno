/**
 * Tests for permissions module.
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  normalizeRoutePath,
  getRouteConfig,
  hasPermission,
  hasAllPermissions,
  getPermissions,
  PERMISSIONS,
} from "./permissions.ts";
import type { JwtClaims } from "./types.ts";

// Helper to create mock claims
function mockClaims(permissions: string[] = []): JwtClaims {
  return {
    iss: "https://test.auth0.com/",
    sub: "auth0|123",
    aud: "https://api.test.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    permissions,
  };
}

Deno.test("normalizeRoutePath - static paths", () => {
  assertEquals(normalizeRoutePath("/healthz"), "/healthz");
  assertEquals(normalizeRoutePath("/readyz"), "/readyz");
  assertEquals(normalizeRoutePath("/v1/prompts"), "/v1/prompts");
  assertEquals(normalizeRoutePath("/v1/prompts/default"), "/v1/prompts/default");
  assertEquals(normalizeRoutePath("/v1/vision/analyze"), "/v1/vision/analyze");
  assertEquals(normalizeRoutePath("/v1/vision/stream"), "/v1/vision/stream");
  assertEquals(normalizeRoutePath("/v1/images/upload"), "/v1/images/upload");
});

Deno.test("normalizeRoutePath - UUID paths", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  assertEquals(normalizeRoutePath(`/v1/prompts/${uuid}`), "/v1/prompts/:id");
  assertEquals(normalizeRoutePath(`/v1/prompts/${uuid}/default`), "/v1/prompts/:id/default");
});

Deno.test("normalizeRoutePath - long alphanumeric IDs", () => {
  const longId = "abc123def456ghi789";
  assertEquals(normalizeRoutePath(`/v1/prompts/${longId}`), "/v1/prompts/:id");
});

Deno.test("getRouteConfig - public routes", () => {
  const healthz = getRouteConfig("GET", "/healthz");
  assertEquals(healthz?.public, true);

  const readyz = getRouteConfig("GET", "/readyz");
  assertEquals(readyz?.public, true);

  const stream = getRouteConfig("POST", "/v1/vision/stream");
  assertEquals(stream?.public, true);
});

Deno.test("getRouteConfig - protected routes", () => {
  const analyze = getRouteConfig("POST", "/v1/vision/analyze");
  assertEquals(analyze?.permissions, [PERMISSIONS.READ_VISION]);
  assertEquals(analyze?.legacyAllowed, undefined);

  const upload = getRouteConfig("POST", "/v1/images/upload");
  assertEquals(upload?.permissions, [PERMISSIONS.WRITE_IMAGES]);

  const listPrompts = getRouteConfig("GET", "/v1/prompts");
  assertEquals(listPrompts?.permissions, [PERMISSIONS.READ_PROMPTS]);
});

Deno.test("getRouteConfig - legacy allowed routes", () => {
  const createPrompt = getRouteConfig("POST", "/v1/prompts");
  assertEquals(createPrompt?.permissions, [PERMISSIONS.WRITE_PROMPTS]);
  assertEquals(createPrompt?.legacyAllowed, true);

  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const updatePrompt = getRouteConfig("PUT", `/v1/prompts/${uuid}`);
  assertEquals(updatePrompt?.permissions, [PERMISSIONS.WRITE_PROMPTS]);
  assertEquals(updatePrompt?.legacyAllowed, true);

  const deletePrompt = getRouteConfig("DELETE", `/v1/prompts/${uuid}`);
  assertEquals(deletePrompt?.permissions, [PERMISSIONS.WRITE_PROMPTS]);
  assertEquals(deletePrompt?.legacyAllowed, true);
});

Deno.test("getRouteConfig - unknown route returns undefined", () => {
  const unknown = getRouteConfig("GET", "/unknown/path");
  assertEquals(unknown, undefined);
});

Deno.test("hasPermission - single permission", () => {
  const claims = mockClaims(["read:vision", "read:prompts"]);
  assertEquals(hasPermission(claims, "read:vision"), true);
  assertEquals(hasPermission(claims, "read:prompts"), true);
  assertEquals(hasPermission(claims, "write:prompts"), false);
});

Deno.test("hasPermission - array of permissions (any)", () => {
  const claims = mockClaims(["read:vision"]);
  assertEquals(hasPermission(claims, ["read:vision", "write:vision"]), true);
  assertEquals(hasPermission(claims, ["write:prompts", "admin"]), false);
});

Deno.test("hasPermission - no permissions in claims", () => {
  const claims = mockClaims();
  assertEquals(hasPermission(claims, "read:vision"), false);
});

Deno.test("hasAllPermissions", () => {
  const claims = mockClaims(["read:vision", "read:prompts", "write:prompts"]);
  assertEquals(hasAllPermissions(claims, ["read:vision", "read:prompts"]), true);
  assertEquals(hasAllPermissions(claims, ["read:vision", "admin"]), false);
});

Deno.test("getPermissions", () => {
  const claims = mockClaims(["read:vision", "write:prompts"]);
  assertEquals(getPermissions(claims), ["read:vision", "write:prompts"]);

  const emptyClams = mockClaims();
  assertEquals(getPermissions(emptyClams), []);
});
