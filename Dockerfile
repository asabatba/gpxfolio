# syntax=docker/dockerfile:1
#
# gpxfolio — CapRover / plain Docker deployment.
#
# Two stages: the builder compiles the SolidStart app with pnpm; the runtime
# image copies out only `.output/`. Nitro's node-server preset bundles every
# dependency the server needs directly into `.output/server/node_modules` —
# including its own copy of better-sqlite3 with a prebuilt native binary for
# every platform it ships (linuxmusl-x64 among them, verified against the
# installed package) — so the runtime stage never needs its own node_modules
# and Alpine needs no compiler toolchain.

FROM node:22-alpine AS builder
WORKDIR /app

# Node 22 ships corepack; enabling it makes `pnpm` resolve to the exact
# version pinned in package.json's "packageManager" field.
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# migrate.mjs has no build step of its own. Copying it next to the built
# server lets it resolve "better-sqlite3" and "drizzle-orm" from
# .output/server/node_modules at run time, which is why the runtime stage
# below never has to carry a node_modules of its own.
RUN cp scripts/migrate.mjs .output/server/migrate.mjs

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# CapRover proxies to port 80 inside the container by default, so the app
# listens there out of the box. Override via the CapRover dashboard's "HTTP
# Settings -> Container HTTP Port" (and this PORT var) if you'd rather not.
ENV PORT=80

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/drizzle ./drizzle

# Routes, their GPX blobs, and the SQLite database all live under here (see
# src/lib/storage.ts). Without a persistent volume mounted at this path,
# every redeploy starts from an empty site. In CapRover: App Configs ->
# Persistent Directories -> add "/app/data".
VOLUME ["/app/data"]

EXPOSE 80

# busybox's wget ships in the base alpine image, so this costs nothing extra.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/" || exit 1

# Migrations run on every container start, not just the first deploy, so a
# schema change shipped in a new image is applied before the server accepts
# traffic. `exec` hands PID 1 to node so a SIGTERM on redeploy reaches the
# server directly instead of being swallowed by the shell.
CMD ["sh", "-c", "node .output/server/migrate.mjs && exec node .output/server/index.mjs"]
