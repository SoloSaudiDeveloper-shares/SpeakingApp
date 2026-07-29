FROM node:24-bookworm-slim AS deps
WORKDIR /app/web

ENV NEXT_TELEMETRY_DISABLED=1

COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS builder
WORKDIR /app/web
ENV SPEAKING_LAB_SKIP_DB_INIT=1
COPY web ./
RUN npm run build

FROM node:24-bookworm-slim AS jobs
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*
COPY web/package.json web/package-lock.json ./
RUN npm ci --omit=dev --omit=optional \
  && find node_modules/drizzle-orm -mindepth 1 -maxdepth 2 -type d -iname '*sqlite*' \
    -prune -exec rm -rf {} +
COPY web/drizzle ./drizzle
COPY web/jobs ./jobs
COPY --chown=node:node certs ./certs
ENV NODE_EXTRA_CA_CERTS=/app/certs/supabase-prod-ca-2021.pem
ENV DATABASE_SSL_CA_PATH=/app/certs/supabase-prod-ca-2021.pem
USER node

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/web/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/web/public ./public
COPY --chown=node:node certs ./certs
ENV NODE_EXTRA_CA_CERTS=/app/certs/supabase-prod-ca-2021.pem
ENV DATABASE_SSL_CA_PATH=/app/certs/supabase-prod-ca-2021.pem

EXPOSE 3000
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
