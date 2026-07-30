import { redirect } from "@solidjs/router";
import { createHash, timingSafeEqual } from "node:crypto";
import { useSession } from "vinxi/http";

/**
 * Single-admin auth: one password from the environment, held in a signed,
 * HttpOnly cookie. There are no user accounts because there is exactly one
 * person who uploads. Viewing routes never requires a session.
 */

interface SessionData {
  admin?: boolean;
}

const SESSION_NAME = "gpx_share_session";

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  // Failing loudly beats silently signing cookies with a default secret, which
  // would let anyone forge an admin session.
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is missing or shorter than 32 characters. Copy .env.example to .env and set it.",
    );
  }
  return secret;
}

function adminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD is not set. Copy .env.example to .env and set it.");
  }
  return password;
}

export function getSession() {
  return useSession<SessionData>({
    password: sessionSecret(),
    name: SESSION_NAME,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Secure cookies would never be sent over plain http, which would lock
      // you out of a local dev server.
      secure: process.env.NODE_ENV === "production",
    },
  });
}

/**
 * Constant-time comparison, so response timing can't be used to recover the
 * password one character at a time. Both sides are hashed to a fixed length
 * first because `timingSafeEqual` throws on length mismatch — and the length
 * difference would itself leak.
 */
function passwordMatches(candidate: string, expected: string): boolean {
  // Comparing SHA-256 digests rather than the raw strings keeps both operands a
  // fixed 32 bytes: `timingSafeEqual` throws on a length mismatch, and the
  // throw itself would leak the password's length.
  const digestA = createHash("sha256").update(candidate, "utf8").digest();
  const digestB = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session.data.admin === true;
}

/** Verifies the password and, on success, marks the session as admin. */
export async function login(password: string): Promise<boolean> {
  if (!passwordMatches(password, adminPassword())) return false;
  const session = await getSession();
  await session.update({ admin: true });
  return true;
}

export async function logout(): Promise<void> {
  const session = await getSession();
  await session.clear();
}

/**
 * Gate for every mutating server action.
 *
 * The middleware already blocks `/admin/*` page loads, but server actions are
 * separately addressable HTTP endpoints — an attacker can POST to one directly
 * without ever loading a guarded page. So each action re-checks here; the
 * middleware is defence in depth, not the gate.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAuthenticated())) {
    throw redirect("/login");
  }
}
