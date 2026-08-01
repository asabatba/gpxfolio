import { Title } from "@solidjs/meta";
import { A } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";
import SiteHeader from "~/components/SiteHeader";

/**
 * Catches every URL that doesn't match a real route. Without this,
 * SolidStart falls through to rendering the homepage with a 200 status — a
 * soft 404 that leaves both visitors and search engines thinking a broken
 * link is fine.
 */
export default function NotFound() {
  return (
    <>
      <HttpStatusCode code={404} text="Not Found" />
      <Title>Page not found</Title>
      <SiteHeader siteName="gpxfolio" />
      <main class="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 class="text-2xl font-semibold">Page not found</h1>
        <p class="ink-muted text-sm">
          This link may have been mistyped, or the page may have moved.
        </p>
        <A href="/" class="btn btn-secondary">
          Go to the homepage
        </A>
      </main>
    </>
  );
}
