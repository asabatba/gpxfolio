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

const MAX_PHOTO_BYTES = 30 * 1024 * 1024;

/** Reads the uploaded photos out of a FormData, enforcing size. Extension is validated server-side. */
async function readImageFiles(formData: FormData, field = "photos") {
  const entries = formData.getAll(field).filter((v): v is File => v instanceof File);
  const files: Array<{ filename: string; bytes: Buffer }> = [];

  for (const file of entries) {
    if (file.size === 0) continue; // Empty file input posts a zero-byte entry.
    const { ValidationError } = await import("./routes.server");
    if (file.size > MAX_PHOTO_BYTES) {
      throw new ValidationError(
        `${file.name} is larger than the ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB limit.`,
      );
    }
    files.push({ filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  }

  return files;
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
    // Straight to editing, not the public page: a freshly created route has no
    // photos yet, and that's the most likely next step.
    throw redirect(`/admin/${result.route.id}/edit`);
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

export const moveTrackAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { moveTrack } = await import("./routes.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  const direction = formData.get("direction") === "up" ? "up" : "down";
  await moveTrack(routeId, String(formData.get("trackId") ?? ""), direction);
  throw redirect(`/admin/${routeId}/edit`);
}, "moveTrack");

export const updateTrackAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { updateTrack, ValidationError } = await import("./routes.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  try {
    await updateTrack(routeId, String(formData.get("trackId") ?? ""), {
      name: String(formData.get("name") ?? ""),
      color: String(formData.get("color") ?? ""),
    });
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw redirect(`/admin/${routeId}/edit`);
}, "updateTrack");

export const deleteRouteAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { deleteRoute } = await import("./routes.server");
  await requireAdmin();

  await deleteRoute(String(formData.get("routeId") ?? ""));
  throw redirect("/admin");
}, "deleteRoute");

/**
 * Deliberate exception to "always redirect on success": the admin needs to
 * see the inference summary (and which photos got placed how) right after
 * upload, so this returns the result inline instead of navigating away. The
 * router still revalidates every active query afterward, so the photo grid
 * on the edit page refreshes regardless.
 */
export const addPhotosAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { addPhotosToRoute } = await import("./photos.server");
  const { ValidationError } = await import("./routes.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  try {
    const files = await readImageFiles(formData);
    if (files.length === 0) return new ValidationError("Select at least one photo.");
    return await addPhotosToRoute(routeId, files);
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
}, "addPhotos");

export const updatePhotoCaptionAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { updatePhotoCaption } = await import("./photos.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  await updatePhotoCaption(
    routeId,
    String(formData.get("photoId") ?? ""),
    String(formData.get("caption") ?? ""),
  );
  throw redirect(`/admin/${routeId}/edit`);
}, "updatePhotoCaption");

export const deletePhotoAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { deletePhoto } = await import("./photos.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  await deletePhoto(routeId, String(formData.get("photoId") ?? ""));
  throw redirect(`/admin/${routeId}/edit`);
}, "deletePhoto");

export const nudgePhotoTimesAction = action(async (formData: FormData) => {
  "use server";
  const { requireAdmin } = await import("./auth");
  const { nudgePhotoTimes } = await import("./photos.server");
  await requireAdmin();

  const routeId = String(formData.get("routeId") ?? "");
  const photoIds = JSON.parse(String(formData.get("photoIds") ?? "[]")) as string[];
  const deltaMinutes = Number(formData.get("deltaMinutes") ?? "0");
  await nudgePhotoTimes(routeId, photoIds, deltaMinutes);
  throw redirect(`/admin/${routeId}/edit`);
}, "nudgePhotoTimes");

export const logoutAction = action(async () => {
  "use server";
  const { logout } = await import("./auth");
  await logout();
  throw redirect("/");
}, "logout");
