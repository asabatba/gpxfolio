import sharp from "sharp";
import { buildOgSvg, type OgImageRoute } from "./og-image";

export type { OgImageRoute };

/**
 * Rasterises `buildOgSvg`'s markup to PNG for `api/routes/[slug]/og.png.ts`.
 *
 * Not a headless browser: the SVG's only inputs are the route's own stored
 * polyline (via `buildThumbnailPaths`, the same math the homepage gallery
 * cards use — see `TrackThumbnail.tsx`) and a few lines of text, well within
 * what SVG can express directly. `sharp`'s bundled libvips links librsvg
 * statically, so this needs no extra system package beyond what photo
 * resizing already requires.
 */
export async function renderRouteOgImage(route: OgImageRoute): Promise<Buffer> {
  const svg = buildOgSvg(route);
  return sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
}
