/**
 * Line colours, assigned per track in order.
 *
 * Chosen against the OpenHikingMap basemap, which renders its own paths, tracks
 * and roads in oranges and yellows over green forest and ochre contour lines. An
 * orange or green track disappears into that; magenta and violet — the
 * convention on printed topo maps for exactly this reason — stay legible, as do
 * strong blues. Nothing here is orange, yellow, or mid-green.
 *
 * Shared between the server (assigns these to saved tracks) and the client
 * (upload preview, before anything is saved) so a route's colours don't shift
 * once it's actually created.
 */
export const TRACK_COLORS = [
  "#e5007d", // magenta
  "#1149c8", // blue
  "#7c1fd6", // violet
  "#00868a", // teal
  "#b3003c", // crimson
  "#0072b8", // steel blue
  "#5d3fd3", // indigo
  "#8b0068", // plum
];
