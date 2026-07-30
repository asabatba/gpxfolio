import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  middleware: "./src/middleware.ts",
  server: {
    preset: "node-server",
  },
  vite: {
    plugins: [tailwindcss()],
    // better-sqlite3 is a native addon; it must stay external to the server bundle.
    ssr: {
      external: ["better-sqlite3"],
    },
    optimizeDeps: {
      /*
       * MapLibre spawns a Web Worker whose URL it resolves relative to its own
       * module. When Vite pre-bundles maplibre-gl into .vinxi/client/deps the
       * worker URL points at a file that isn't served, the request fails with
       * ERR_FAILED, and the map silently never fires `load` — no tiles, no
       * track, no error. Excluding it from pre-bundling keeps the worker
       * resolvable in dev.
       */
      exclude: ["maplibre-gl"],
    },
  },
});
