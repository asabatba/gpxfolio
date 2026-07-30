# syntax=docker/dockerfile:1
#
# gpxfolio — CapRover / plain Docker deployment.
#
# Two stages: the builder compiles the SolidStart app with pnpm; the runtime
# image copies out `.output/` (the built server), `migrations/` and a
# production-only node_modules.

FROM node:24-alpine AS builder
WORKDIR /app

# better-sqlite3 ships prebuilt binaries for several platforms, but has no
# install/postinstall script of its own — only a binding.gyp — and npm/pnpm's
# implicit rule for that combination is to run `node-gyp rebuild` at install
# time regardless of whether a usable prebuild exists. Alpine's base image has
# neither Python nor a compiler, so that step fails immediately ("Could not
# find any Python installation") without this toolchain. It's discarded with
# this stage, so none of it reaches the runtime image.
RUN apk add --no-cache python3 make g++

# Node 24 ships corepack; enabling it makes `pnpm` resolve to the exact
# version pinned in package.json's "packageManager" field.
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Drops devDependencies (vite, vitest, typescript, tailwind, ...) but keeps
# everything "dependencies" in package.json needs — better-sqlite3 (with the
# native binding just compiled above, so it's carried across already built
# rather than needing the toolchain again) and kysely among them.
#
# This full copy is what scripts/migrate.mjs runs against at container start.
# Nitro's own build only bundles into .output/server/node_modules the exact
# files it can prove the *compiled server* needs — migrate.mjs is a separate
# script outside that trace, so what it imports (`kysely/migration`, and the
# migration files themselves) is invisible to the tracer. A real node_modules
# sidesteps needing to reason about what Nitro's tracer did or didn't include.
RUN pnpm prune --prod

# ---------------------------------------------------------------------------

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
# CapRover proxies to port 80 inside the container by default, so the app
# listens there out of the box. Override via the CapRover dashboard's "HTTP
# Settings -> Container HTTP Port" (and this PORT var) if you'd rather not.
ENV PORT=80

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

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
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node .output/server/index.mjs"]
