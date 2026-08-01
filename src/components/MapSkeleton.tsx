/**
 * Placeholder shown before the map is ready — either because `RouteMap`'s
 * client-only chunk hasn't loaded yet, or (see `RouteMap.tsx`'s `ready`
 * signal) because it's loaded but MapLibre hasn't fired `load` yet. Same
 * markup covers both gaps so there's no visible handoff between them.
 */
export default function MapSkeleton(props: { class?: string }) {
  return (
    <div class={`surface-sunken flex items-center justify-center ${props.class ?? ""}`}>
      <div class="ink-muted flex animate-pulse items-center gap-2 text-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9 20 3 17.5V6.5L9 9m0 11 6-2.5m-6 2.5V9m6 8.5 6 2.5V9.5L15 7m0 10.5V7m0 0L9 9m6-2-6 2"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        Loading map…
      </div>
    </div>
  );
}
