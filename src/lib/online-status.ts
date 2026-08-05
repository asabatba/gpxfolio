import { createSignal, onCleanup, onMount } from "solid-js";

/**
 * Tracks `navigator.onLine`, reactively. Starts `false` (assumed online) so
 * server-rendered markup never touches `navigator` — it only exists in the
 * browser — and corrects itself in `onMount`, which never runs during SSR.
 *
 * `online`/`offline` events fire on genuine connectivity changes but can lag
 * or miss real-world flakiness (a phone with one bar of signal often reports
 * `onLine: true` right up until a fetch times out) — this is a best-effort
 * signal for UI affordances, not a guarantee a request will succeed.
 */
export function createOnlineSignal() {
  const [offline, setOffline] = createSignal(false);

  onMount(() => {
    setOffline(!navigator.onLine);
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    onCleanup(() => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    });
  });

  return offline;
}
