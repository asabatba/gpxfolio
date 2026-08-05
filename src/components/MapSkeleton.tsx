/**
 * Placeholder shown whenever there's no map to draw — either because
 * `RouteMap`'s client-only chunk hasn't loaded yet, because it's loaded but
 * MapLibre hasn't fired `load` yet, or (see `RouteMap.tsx`'s offline
 * handling) because there's no connection to fetch a style/tiles with at
 * all. Same markup covers all three so there's no visible handoff between
 * them beyond the message; `pulse: false` drops the loading animation for
 * the offline case, which isn't a transient state.
 */
export default function MapSkeleton(props: { class?: string; message?: string; pulse?: boolean }) {
  return (
    <div class={`surface-sunken flex items-center justify-center ${props.class ?? ""}`}>
      <div
        class={`ink-muted flex items-center gap-2 text-sm ${props.pulse === false ? "" : "animate-pulse"}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 20 3 17.5V6.5L9 9m0 11 6-2.5m-6 2.5V9m6 8.5 6 2.5V9.5L15 7m0 10.5V7m0 0L9 9m6-2-6 2"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        {props.message ?? "Loading map…"}
      </div>
    </div>
  );
}
