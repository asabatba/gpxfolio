import { Encoder, Profile, type Encodable, type FileIdMesg, type RecordMesg } from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import { fitToGpxXml, parseFit } from "./parse-fit";
import { GpxParseError } from "./types";

/** Round-trips through the SDK's own encoder, so the fixture is always a genuinely valid .fit file. */
const toSemicircles = (degrees: number) => Math.round(degrees * (2 ** 31 / 180));

interface RecordInput {
  timestamp: Date;
  lat: number;
  lon: number;
  altitude?: number;
  heartRate?: number;
}

function buildFit(records: RecordInput[]): Uint8Array {
  const encoder = new Encoder();
  const fileId: Encodable<FileIdMesg> = {
    mesgNum: Profile.MesgNum.FILE_ID,
    type: 4, // activity
    manufacturer: 1,
    timeCreated: records[0]?.timestamp ?? new Date(),
  };
  encoder.writeMesg(fileId);
  for (const record of records) {
    const mesg: Encodable<RecordMesg> = {
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: record.timestamp,
      positionLat: toSemicircles(record.lat),
      positionLong: toSemicircles(record.lon),
      ...(record.altitude != null ? { altitude: record.altitude } : {}),
      ...(record.heartRate != null ? { heartRate: record.heartRate } : {}),
    };
    encoder.writeMesg(mesg);
  }
  return encoder.close();
}

const TWO_POINTS: RecordInput[] = [
  { timestamp: new Date("2024-06-01T08:00:00Z"), lat: 45.5, lon: -73.6, altitude: 123.4, heartRate: 140 },
  { timestamp: new Date("2024-06-01T08:00:10Z"), lat: 45.501, lon: -73.601, altitude: 125, heartRate: 142 },
];

describe("parseFit", () => {
  it("decodes position, elevation, time and heart rate into one track", () => {
    const parsed = parseFit(buildFit(TWO_POINTS));
    expect(parsed.tracks).toHaveLength(1);
    const [point1, point2] = parsed.tracks[0].points;

    // Semicircle round-trip through the encoder's own conversion is exact to
    // several decimal places, not bit-for-bit — the encoder rounds to the
    // nearest semicircle on the way in.
    expect(point1.lat).toBeCloseTo(45.5, 5);
    expect(point1.lon).toBeCloseTo(-73.6, 5);
    expect(point1.ele).toBeCloseTo(123.4, 5);
    expect(point1.hr).toBe(140);
    expect(point1.time).toBe(new Date("2024-06-01T08:00:00Z").getTime());

    expect(point2.lat).toBeCloseTo(45.501, 5);
    expect(point2.hr).toBe(142);
  });

  it("skips records with no GPS fix rather than failing the whole file", () => {
    const encoder = new Encoder();
    const fileId: Encodable<FileIdMesg> = {
      mesgNum: Profile.MesgNum.FILE_ID,
      type: 4,
      manufacturer: 1,
      timeCreated: new Date(),
    };
    encoder.writeMesg(fileId);
    // An indoor-trainer-style record: no position at all.
    const noFix: Encodable<RecordMesg> = {
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: new Date("2024-06-01T08:00:00Z"),
      heartRate: 130,
    };
    encoder.writeMesg(noFix);
    for (const record of TWO_POINTS) {
      const mesg: Encodable<RecordMesg> = {
        mesgNum: Profile.MesgNum.RECORD,
        timestamp: record.timestamp,
        positionLat: toSemicircles(record.lat),
        positionLong: toSemicircles(record.lon),
      };
      encoder.writeMesg(mesg);
    }

    const parsed = parseFit(encoder.close());
    expect(parsed.tracks[0].points).toHaveLength(2); // The fix-less record is skipped, not fatal.
  });

  it("rejects bytes that aren't a FIT file at all", () => {
    const bogus = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(() => parseFit(bogus)).toThrow(GpxParseError);
    expect(() => parseFit(bogus)).toThrow(/doesn't look like a Garmin \.fit file/);
  });

  it("rejects a file with fewer than two usable GPS points", () => {
    expect(() => parseFit(buildFit([TWO_POINTS[0]]))).toThrow(/No usable GPS track/);
  });
});

describe("fitToGpxXml", () => {
  it("produces GPX text that a plain XML parse would recognise as a <gpx><trk>", () => {
    const xml = fitToGpxXml(buildFit(TWO_POINTS));
    expect(xml).toContain("<gpx");
    expect(xml).toContain("<trk>");
    expect(xml).toContain("<gpxtpx:hr>140</gpxtpx:hr>");
    expect(xml).toContain("<time>2024-06-01T08:00:00.000Z</time>");

    // Semicircle round-tripping loses precision (~2cm), so this checks the
    // value landed close to 45.5, not an exact literal string.
    const latMatch = xml.match(/<trkpt lat="([^"]+)"/);
    expect(Number(latMatch?.[1])).toBeCloseTo(45.5, 5);
  });
});
