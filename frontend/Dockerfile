# Multi-stage so ONE Dockerfile serves both modes (Phase 10 perf pass):
#   • dev  (default) — `next dev --turbopack`, source bind-mounted, hot reload
#   • prod (opt-in)  — `next build` once, then `next start`: precompiled,
#                       minified, ~50ms refresh, NO hot reload
# docker-compose picks the stage via `target:` (dev by default; the prod
# override flips it). Node 22 LTS pinned so the build is reproducible
# regardless of the host's Node.
FROM node:22-alpine AS base
WORKDIR /app
# Layer-caching: install deps before copying source.
COPY package.json ./
RUN npm install
EXPOSE 3000

# --- dev: the everyday coding image (compose default target) -------------
FROM base AS dev
# Source is bind-mounted by docker-compose for hot reload.
CMD ["npm", "run", "dev"]

# --- prod: the "use it like a real app" image (opt-in) -------------------
FROM base AS prod
# Bake the source in and compile once. No bind mount at runtime, so editing
# a file does nothing until you rebuild — that's the trade for the speed.
COPY . .
RUN npm run build
CMD ["npm", "run", "start"]
