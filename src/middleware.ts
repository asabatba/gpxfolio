import { createMiddleware } from "@solidjs/start/middleware";
import { redirect } from "@solidjs/router";
import { isAuthenticated } from "./lib/auth";

/**
 * Blocks unauthenticated page loads of /admin/*.
 *
 * This is a convenience layer so visitors get sent to the login page instead of
 * a broken screen. It is NOT the security boundary: server actions are their own
 * HTTP endpoints and can be called without loading a page, so each one calls
 * `requireAdmin()` itself (see src/lib/auth.ts).
 */
export default createMiddleware({
  onRequest: async (event) => {
    const { pathname } = new URL(event.request.url);
    if (!pathname.startsWith("/admin")) return;

    if (!(await isAuthenticated())) {
      // Come back to the requested page after a successful login.
      const next = encodeURIComponent(pathname);
      return redirect(`/login?next=${next}`);
    }
  },
});
