import { Title } from "@solidjs/meta";
import { action, redirect, useSubmission } from "@solidjs/router";
import { Show } from "solid-js";
import SiteHeader from "~/components/SiteHeader";

const loginAction = action(async (formData: FormData) => {
  "use server";
  const { login } = await import("~/lib/auth");

  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/admin");

  if (!(await login(password))) {
    // Returned rather than thrown so the form can show it inline.
    return new Error("That password is not correct.");
  }

  // Only allow same-site redirects, so a crafted ?next= can't bounce someone
  // to another origin after logging in.
  throw redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/admin");
}, "login");

export default function Login() {
  const submission = useSubmission(loginAction);
  const next = () =>
    typeof window === "undefined"
      ? "/admin"
      : new URLSearchParams(window.location.search).get("next") || "/admin";

  return (
    <>
      <Title>Sign in</Title>
      <SiteHeader siteName="Sign in" />
      <main class="mx-auto flex w-full max-w-sm flex-col justify-center px-4 py-12 sm:py-20">
        <h1 class="text-xl font-semibold">Sign in to manage routes</h1>
        <p class="ink-muted mt-1 text-sm">
          Viewing routes is public; uploading needs the admin password.
        </p>

        <form action={loginAction} method="post" class="mt-6 flex flex-col gap-4">
          <input type="hidden" name="next" value={next()} />
          <div>
            <label class="label" for="password">
              Admin password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              class="field"
              autocomplete="current-password"
              required
              autofocus
            />
          </div>

          <Show when={submission.result instanceof Error}>
            <p role="alert" class="text-sm" style={{ color: "#e03131" }}>
              {(submission.result as Error).message}
            </p>
          </Show>

          <button type="submit" class="btn btn-primary" disabled={submission.pending}>
            {submission.pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </main>
    </>
  );
}
