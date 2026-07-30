import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readPhotoExif } from "./exif";

const fixture = (name: string) => resolve(import.meta.dirname, "../../../test/fixtures", name);

describe("readPhotoExif", () => {
  it("reads a naive DateTimeOriginal with no offset or GPS", async () => {
    const exif = await readPhotoExif(await readFile(fixture("photo-naive.jpg")));
    expect(exif.naiveDateTimeOriginal).toBe(Date.UTC(2024, 6, 15, 14, 30, 0));
    expect(exif.offsetMinutes).toBeNull();
    expect(exif.gpsUtcMs).toBeNull();
    expect(exif.lat).toBeNull();
    expect(exif.lon).toBeNull();
  });

  it("reads an explicit OffsetTimeOriginal", async () => {
    const exif = await readPhotoExif(await readFile(fixture("photo-offset.jpg")));
    expect(exif.naiveDateTimeOriginal).toBe(Date.UTC(2024, 6, 15, 14, 30, 0));
    expect(exif.offsetMinutes).toBe(120);
  });

  it("reads GPS lat/lon and GPS UTC timestamp", async () => {
    const exif = await readPhotoExif(await readFile(fixture("photo-gps.jpg")));
    expect(exif.lat).toBeCloseTo(42.6975, 4);
    expect(exif.lon).toBeCloseTo(1.0165, 4);
    expect(exif.gpsUtcMs).toBe(Date.UTC(2024, 6, 15, 12, 30, 0));
  });
});
