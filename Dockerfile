FROM node:20-bookworm-slim AS deps
WORKDIR /app/web

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM deps AS builder
WORKDIR /app/web
ENV SPEAKING_LAB_SKIP_DB_INIT=1
COPY web ./
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV SPEAKING_LAB_DATA_DIR=/data/db
ENV SPEAKING_LAB_AUDIO_DIR=/data/audio-archive

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/db /data/audio-archive

COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./.next/static
COPY --from=builder /app/web/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
