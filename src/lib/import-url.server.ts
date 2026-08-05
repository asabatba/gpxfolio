import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetches a GPX file from a URL the admin pastes in, instead of a manual
 * download-then-reupload — Strava's own activity pages expose an "Export
 * GPX" link, which is exactly what this is meant to consume. This is the
 * fallback the OAuth integrations (Strava/Garmin/Komoot) turned out not to
 * be worth; see .wayfinder/tickets/import-from-other-services.md.
 *
 * Server-only by construction: an arbitrary third-party URL almost never
 * sends CORS headers a browser `fetch` would respect, so this has to run
 * server-side regardless — which is also why it needs the SSRF hardening
 * below (a form field that makes *the server* fetch an admin-supplied URL is
 * exactly the shape of request that can otherwise be pointed at internal
 * infrastructure).
 */

export class ImportUrlError extends Error {}

const MAX_BYTES = 25 * 1024 * 1024; // Matches the regular upload path's per-file cap.
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/**
 * Loopback, link-local (which covers the 169.254.169.254 cloud metadata
 * endpoint most SSRF exploits actually target), and the RFC 1918/4193
 * private ranges — addresses a server-side fetch should never be allowed to
 * reach on an admin's behalf.
 */
function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  return true; // Not a recognisable literal IP — treat as unsafe rather than guess.
}

/**
 * Resolves the hostname and rejects private addresses before every fetch —
 * including after following a redirect, since a redirect is exactly how a
 * public-looking URL can end up pointing somewhere internal. This is a
 * best-effort check (a DNS answer could still change between this lookup and
 * the fetch a moment later), appropriate for a single-admin personal tool,
 * not a defense against a determined DNS-rebinding attacker.
 */
async function assertPublicHost(hostname: string) {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new ImportUrlError("That URL points at a private address.");
    return;
  }
  const { address } = await lookup(hostname);
  if (isPrivateAddress(address)) throw new ImportUrlError("That URL points at a private address.");
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return await response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ImportUrlError(`That file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}

/**
 * Content-Disposition's filename when the server sends one (Strava's export
 * link does); otherwise the URL's last path segment, `.gpx`-suffixed if it
 * doesn't already look like it has an extension. Never used to *validate*
 * the content — Strava's own export URL has no `.gpx` in it at all — only to
 * label the track afterward. `parseGpx` downstream is what actually decides
 * whether the fetched bytes are usable.
 */
function filenameFrom(response: Response, url: URL): string {
  const disposition = response.headers.get("content-disposition");
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  const last = url.pathname.split("/").filter(Boolean).pop();
  if (last) return /\.[a-z0-9]+$/i.test(last) ? last : `${last}.gpx`;
  return "imported.gpx";
}

export async function fetchGpxFromUrl(rawUrl: string): Promise<{ filename: string; xml: string }> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new ImportUrlError("That doesn't look like a valid URL.");
  }

  for (let redirects = 0; ; redirects++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new ImportUrlError("Only http(s) URLs are supported.");
    }
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      // Redirects are followed by hand (not `redirect: "follow"`) so each hop's
      // host gets the same private-address check as the original URL.
      response = await fetch(current, { redirect: "manual", signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ImportUrlError("Timed out fetching that URL.");
      }
      throw new ImportUrlError(`Couldn't fetch that URL: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ImportUrlError("That URL redirected without a destination.");
      if (redirects >= MAX_REDIRECTS) throw new ImportUrlError("Too many redirects.");
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw new ImportUrlError(`That URL returned ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BYTES) {
      throw new ImportUrlError(`That file is larger than the ${Math.round(MAX_BYTES / 1024 / 1024)} MB limit.`);
    }

    const xml = await readCapped(response, MAX_BYTES);
    return { filename: filenameFrom(response, current), xml };
  }
}
