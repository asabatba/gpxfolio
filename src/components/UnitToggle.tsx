import { createEffect, createSignal, onMount } from "solid-js";
import type { UnitSystem } from "~/lib/format";

const STORAGE_KEY = "gpx-share:units";

/**
 * Unit preference, persisted locally.
 *
 * `createSignal` starts at "metric" on both server and client so the first
 * render matches and hydration doesn't warn; the stored preference is applied in
 * `onMount`, after hydration.
 */
export function createUnitPreference() {
  const [units, setUnits] = createSignal<UnitSystem>("metric");

  onMount(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "imperial" || stored === "metric") setUnits(stored);
  });

  createEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, units());
    }
  });

  return [units, setUnits] as const;
}

interface UnitToggleProps {
  units: () => UnitSystem;
  setUnits: (value: UnitSystem) => void;
}

export default function UnitToggle(props: UnitToggleProps) {
  const isMetric = () => props.units() === "metric";

  return (
    <div
      class="surface-raised inline-flex overflow-hidden rounded-lg border border-subtle text-xs font-semibold"
      role="group"
      aria-label="Unit system"
    >
      <button
        type="button"
        class="min-h-[44px] px-3.5 py-2 text-xs font-semibold"
        style={{
          "background-color": isMetric() ? "var(--accent)" : "transparent",
          color: isMetric() ? "#fff" : "var(--ink-muted)",
        }}
        aria-pressed={isMetric()}
        onClick={() => props.setUnits("metric")}
      >
        km
      </button>
      <button
        type="button"
        class="min-h-[44px] px-3.5 py-2 text-xs font-semibold"
        style={{
          "background-color": !isMetric() ? "var(--accent)" : "transparent",
          color: !isMetric() ? "#fff" : "var(--ink-muted)",
        }}
        aria-pressed={!isMetric()}
        onClick={() => props.setUnits("imperial")}
      >
        mi
      </button>
    </div>
  );
}
