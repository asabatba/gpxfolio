import { afterEach, describe, expect, it, vi } from "vitest";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));

const { fetchGpxFromUrl, ImportUrlError } = await import("./import-url.server");

function gpxResponse(body: string, headers: Record<string, string> = {}) {
  return new Response(body, { status: 200, headers: { "content-type": "text/xml", ...headers } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  lookup.mockReset();
});

describe("fetchGpxFromUrl", () => {
  it("rejects a malformed URL", async () => {
    await expect(fetchGpxFromUrl("not a url")).rejects.toThrow(ImportUrlError);
  });

  it("rejects a non-http(s) protocol", async () => {
    await expect(fetchGpxFromUrl("file:///etc/passwd")).rejects.toThrow(/http\(s\)/);
  });

  it("rejects a literal loopback/private-range IP without ever calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchGpxFromUrl("http://127.0.0.1/x")).rejects.toThrow(/private address/);
    await expect(fetchGpxFromUrl("http://10.0.0.5/x")).rejects.toThrow(/private address/);
    await expect(fetchGpxFromUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
      /private address/,
    );
    await expect(fetchGpxFromUrl("http://192.168.1.1/x")).rejects.toThrow(/private address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    lookup.mockResolvedValue({ address: "10.1.2.3", family: 4 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchGpxFromUrl("http://internal.example.com/x")).rejects.toThrow(/private address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and returns the body when the resolved host is public", async () => {
    lookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(gpxResponse("<gpx></gpx>")),
    );

    const result = await fetchGpxFromUrl("https://example.com/route.gpx");
    expect(result.xml).toBe("<gpx></gpx>");
    expect(result.filename).toBe("route.gpx");
  });

  it("prefers the Content-Disposition filename when present", async () => {
    lookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        gpxResponse("<gpx></gpx>", { "content-disposition": 'attachment; filename="My Ride.gpx"' }),
      ),
    );

    const result = await fetchGpxFromUrl("https://example.com/activities/1/export_gpx");
    expect(result.filename).toBe("My Ride.gpx");
  });

  it("falls back to a .gpx-suffixed name when the URL has no recognisable extension", async () => {
    lookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(gpxResponse("<gpx></gpx>")));

    const result = await fetchGpxFromUrl("https://www.strava.com/activities/12345/export_gpx");
    expect(result.filename).toBe("export_gpx.gpx");
  });

  it("re-validates the host after following a redirect, rejecting an internal target", async () => {
    lookup.mockResolvedValueOnce({ address: "93.184.216.34", family: 4 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }),
      ),
    );

    await expect(fetchGpxFromUrl("https://example.com/redirect-me")).rejects.toThrow(/private address/);
  });

  it("follows a redirect to a legitimate host and returns its body", async () => {
    lookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://cdn.example.com/route.gpx" } }),
      )
      .mockResolvedValueOnce(gpxResponse("<gpx></gpx>"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGpxFromUrl("https://example.com/redirect-me");
    expect(result.xml).toBe("<gpx></gpx>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a response advertising a Content-Length over the size cap", async () => {
    lookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(gpxResponse("<gpx></gpx>", { "content-length": String(30 * 1024 * 1024) })),
    );

    await expect(fetchGpxFromUrl("https://example.com/huge.gpx")).rejects.toThrow(/MB limit/);
  });

  it("surfaces a non-2xx status", async () => {
    lookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));

    await expect(fetchGpxFromUrl("https://example.com/missing.gpx")).rejects.toThrow(/404/);
  });
});
