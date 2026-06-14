# Single image for both Railway services (deterministic — only one Dockerfile so the
# builder can't pick the wrong one). SERVICE_TARGET selects what to run; BUILD_WEB=1
# (set only on the web service) triggers the Next.js build.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .

# Workspace packages (@handoff/*) + the standalone backend's own deps (better-sqlite3).
RUN npm install --no-audit --no-fund
RUN cd backend && npm install --no-audit --no-fund

# Web build (only when BUILD_WEB=1). NEXT_PUBLIC_* are inlined at build time; Railway
# passes the service variables in as build args matching these ARG names.
ARG BUILD_WEB
ARG NEXT_PUBLIC_MOCK
ARG NEXT_PUBLIC_DYNAMIC_ENV_ID
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_ESCROW_ADDRESS
ARG NEXT_PUBLIC_USDC_ADDRESS
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_BLINK_MERCHANT_ID
ARG NEXT_PUBLIC_BLINK_SIGNER_PATH
ARG NEXT_PUBLIC_DATASTREAMS_FEED_ETHUSD
ENV NEXT_PUBLIC_MOCK=$NEXT_PUBLIC_MOCK \
    NEXT_PUBLIC_DYNAMIC_ENV_ID=$NEXT_PUBLIC_DYNAMIC_ENV_ID \
    NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_ESCROW_ADDRESS=$NEXT_PUBLIC_ESCROW_ADDRESS \
    NEXT_PUBLIC_USDC_ADDRESS=$NEXT_PUBLIC_USDC_ADDRESS \
    NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL \
    NEXT_PUBLIC_BLINK_MERCHANT_ID=$NEXT_PUBLIC_BLINK_MERCHANT_ID \
    NEXT_PUBLIC_BLINK_SIGNER_PATH=$NEXT_PUBLIC_BLINK_SIGNER_PATH \
    NEXT_PUBLIC_DATASTREAMS_FEED_ETHUSD=$NEXT_PUBLIC_DATASTREAMS_FEED_ETHUSD
RUN if [ "$BUILD_WEB" = "1" ]; then npm --workspace apps/web run build; fi

# SERVICE_TARGET=web → Next server; otherwise → Fastify backend. Both listen on $PORT.
CMD ["sh","-c","if [ \"$SERVICE_TARGET\" = web ]; then cd apps/web && node insync-server.js; else cd backend && npm run start; fi"]
