// @refresh reload
import { mount, StartClient } from "@solidjs/start/client";

mount(() => <StartClient />, document.getElementById("app") as HTMLElement);

// Registered only in production: a service worker caching dev's ever-changing
// chunks would fight HMR. See public/sw.js for what it actually caches.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
