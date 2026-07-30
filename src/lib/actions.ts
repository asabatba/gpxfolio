import { action, redirect } from "@solidjs/router";

/**
 * Server actions for the admin pages.
 *
 * Every one of these calls `requireAdmin()` first. Actions are individually
 * addressable HTTP endpoints, so the /admin middleware does not protect them —
 * this is where access is actually enforced.
 */

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Reads the uploaded GPX files out of a FormData, enforcing size and type. */
async function readGpxFiles(formData: FormData, field = "files") {
  const { ValidationError } = await import("./routes.server");
  const entries = formData.getAll(field).filter((v): v is File => v instanceof File);
  const files: Array<{ filename: string; xml: string }> = [];

  for (const file of entries) {
    if (file.size === 0) continue; // Empty file input posts a zero-byte entry.
    if (!/\.gpx$/i.test(file.name)) {
      throw new ValidationError(`${file.name} is not a .gpx file.`);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new ValidationError(
        `${file.name} is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit.`,
      );
    }
    files.push({ filename: file.name, xml: await file.text() });
  }

  return files;
}

function visibilityOf(formData: FormData): "public" | "unlisted" {
  return formData.get("visibility") === "public" ? "public" : "unlisted";
}

/**
 * Errors are returned, not thrown, so the form can render them inline;
 * `redirect` is still thrown, which is how the router detects a navigation.
 */
export const createRouteAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { createRoute, ValidationError } = await import("./routes.server");
  await requireAdmin();

  try {
    const files = await readGpxFiles(formData);
    const result = await createRoute({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      activityType: String(formData.get("activityType") ?? ""),
      visibility: visibilityOf(formData),
      files,
    });
    throw redirect(`/r/${result.route.slug}`);
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
}, "createRoute");

export const updateRouteAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { updateRoute, ValidationError } = await import("./routes.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  try {
    await updateRoute(routeId, {
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      activityType: String(formData.get("activityType") ?? ""),
      visibility: visibilityOf(formData),
    });
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw redirect(`/admin/${routeId}/edit`);
}, "updateRoute");

export const addTracksAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { addTracksToRoute, ValidationError } = await import("./routes.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  try {
    const files = await readGpxFiles(formData);
    if (files.length === 0) return new ValidationError("Select at least one GPX file.");
    await addTracksToRoute(routeId, files);
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw redirect(`/admin/${routeId}/edit`);
}, "addTracks");

export const setVisibilityAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { updateRoute } = await import("./routes.server");
  await requireAdmin();

  await updateRoute(String(formData.get("routeId") ?? ""), {
    visibility: visibilityOf(formData),
  });
  throw redirect("/admin");
}, "setVisibility");

export const deleteTrackAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { deleteTrack } = await import("./routes.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  await deleteTrack(routeId, String(formData.get("trackId") ?? ""));
  throw redirect(`/admin/${routeId}/edit`);
}, "deleteTrack");

export const deleteRouteAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { deleteRoute } = await import("./routes.server");
  await requireAdmin();

  await deleteRoute(String(formData.get("routeId") ?? ""));
  throw redirect("/admin");
}, "deleteRoute");

export const logoutAction = action(async () => {
  "use server";
  const { logout } = await import("./auth");
  await logout();
  throw redirect("/");
}, "logout");
