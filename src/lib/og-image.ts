import { buildThumbnailPaths } from "./gpx/thumbnail-paths";
import { formatDate, formatDistance, formatElevation } from "./format";

/**
 * Builds the SVG markup for a route's link-preview image — the part with no
 * I/O, split out from `og-image.server.ts` (which rasterises this with
 * `sharp`) purely so it's unit-testable without a native dependency, the same
 * split `photos/exif.ts`/`photos/match.ts`/`photos/offset.ts` use against
 * `photos.server.ts`.
 */

const WIDTH = 1200;
const HEIGHT = 630;
const PANEL_W = 480;
const PAD = 48;

export interface OgImageRoute {
  title: string;
  activityType: string | null;
  distanceM: number;
  elevationGainM: number;
  startedAt: Date | null;
  siteName: string;
  tracks: Array<{ geometry: string; color: string }>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Greedy word-wrap against an estimated glyph width — SVG `<text>` never
 * wraps on its own. The estimate only has to be close enough that nothing
 * overflows the panel; a slightly-early break reads fine, an overflowing one
 * doesn't.
 */
export function wrapLines(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const avgCharWidth = fontSize * 0.56;
  const maxChars = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  // Whatever didn't fit collapses into the last line with an ellipsis, rather
  // than silently disappearing off the edge of the panel.
  const consumed = lines.join(" ").length;
  if (consumed < text.length && lines.length >= maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : `${last}…`;
  }
  return lines.slice(0, maxLines);
}

/**
 * Text uses the generic `sans-serif` family rather than naming a specific
 * font: librsvg (which `sharp` rasterises through) resolves it via
 * fontconfig, and naming anything more specific risks silently falling back
 * to *no* text on a minimal container that lacks that exact family.
 */
export function buildOgSvg(route: OgImageRoute): string {
  const paths = buildThumbnailPaths(route.tracks, WIDTH - PANEL_W, HEIGHT, 56);

  const titleLines = wrapLines(route.title, PANEL_W - PAD * 2, 56, 3);
  const titleTspans = titleLines
    .map((line, i) => `<tspan x="${PAD}" dy="${i === 0 ? 0 : 62}">${escapeXml(line)}</tspan>`)
    .join("");

  const statParts = [formatDistance(route.distanceM), `${formatElevation(route.elevationGainM)} ascent`];
  if (route.activityType) statParts.unshift(route.activityType);
  if (route.startedAt) statParts.push(formatDate(route.startedAt));
  const statsLine = escapeXml(statParts.join("  ·  "));

  // `buildThumbnailPaths` projects into a 0,0-origin box the size of the right
  // panel — translate the whole group into that panel rather than re-deriving
  // the offset per point.
  const trackPaths = paths
    .map(
      (path) => `
      <path d="${path.d}" fill="none" stroke="#ffffff" stroke-width="9" stroke-linejoin="round" stroke-linecap="round" opacity="0.6" />
      <path d="${path.d}" fill="none" stroke="${path.color}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" />`,
    )
    .join("");

  const titleY = HEIGHT / 2 - 8 - (titleLines.length - 1) * 31;

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff" />
    <rect width="${PANEL_W}" height="${HEIGHT}" fill="#f6f7f9" />
    <rect x="${PANEL_W}" width="1" height="${HEIGHT}" fill="#e2e5ea" />
    <rect x="${PANEL_W}" y="0" width="${WIDTH - PANEL_W}" height="${HEIGHT}" fill="#ffffff" />
    <g transform="translate(${PANEL_W},0)">${trackPaths}</g>
    <text x="${PAD}" y="${PAD + 26}" font-family="sans-serif" font-size="22" font-weight="600" letter-spacing="1" fill="#5c6470">${escapeXml(route.siteName.toUpperCase())}</text>
    <text x="${PAD}" y="${titleY}" font-family="sans-serif" font-size="56" font-weight="700" fill="#14171c">${titleTspans}</text>
    <text x="${PAD}" y="${HEIGHT - PAD}" font-family="sans-serif" font-size="26" fill="#5c6470">${statsLine}</text>
  </svg>`;
}
