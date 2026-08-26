# Recall Tracker — Recall Discovery worker (internal only).
#
# Build from the REPO ROOT:
#   docker build -f apps/recall-worker/Dockerfile -t recall-worker .
#
# No build step: the service runs its TypeScript directly under Node's native
# type stripping, which is why packages/shared ships as source rather than as a
# compiled artifact.
#
# MUST run at replicas: 1. The active-discoveries registry is an in-memory Map
# of AbortControllers, so status and cancel are only correct when every request
# reaches the process that started the discovery.

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Manifests first so the dependency layer caches independently of source.
# packages/shared is a workspace dependency, so its manifest is required for npm
# to resolve the graph.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node packages/shared/package.json ./packages/shared/
COPY --chown=node:node apps/recall-worker/package.json ./apps/recall-worker/
RUN npm ci --workspace @recall/worker --include-workspace-root --omit=dev

# Source. packages/shared is consumed as TypeScript, not built.
COPY --chown=node:node packages/shared ./packages/shared
COPY --chown=node:node apps/recall-worker ./apps/recall-worker

USER node

ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/recall-worker/src/server.ts"]
