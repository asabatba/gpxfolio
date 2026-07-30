import { randomBytes } from "node:crypto";

/**
 * Crockford-style base32 without look-alike characters (no I, L, O, U), so an id
 * read off a screen or a URL can't be mistyped into a different valid one.
 */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Random id from CSPRNG bytes.
 *
 * `randomBytes` rather than `Math.random` because these ids are the only thing
 * protecting an unlisted route: 12 characters of base32 is ~60 bits, far beyond
 * guessing range.
 */
export function generateId(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    // A 256-value byte modulo 32 is unbiased, since 32 divides 256 exactly.
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Turns a title into a URL-safe fragment. Diacritics are decomposed and
 * stripped so "Vall d'Aran, Pyrénées" yields "vall-d-aran-pyrenees" rather than
 * dropping the accented characters entirely.
 */
export function slugifyTitle(title: string): string {
  return title
    // NFKD splits "é" into "e" + a combining mark, which \p{M} then removes.
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Builds the public slug: a random prefix plus a readable suffix.
 *
 * The random prefix is what makes an unlisted route unguessable — the title is
 * cosmetic, so two routes with the same name never collide, and editing a title
 * later doesn't have to invalidate an already-shared link.
 */
export function buildSlug(title: string): string {
  const readable = slugifyTitle(title);
  const random = generateId(8);
  return readable ? `${random}-${readable}` : random;
}
