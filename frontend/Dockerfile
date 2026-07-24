FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY frontend/package.json frontend/package.json
RUN pnpm install --filter @launchproof/frontend... --frozen-lockfile
COPY frontend frontend
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_XLAYER_RPC_URL
ARG NEXT_PUBLIC_REGISTRY_ADDRESS
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK
ARG NEXT_PUBLIC_PAYOUT_ADDRESS
ARG NEXT_PUBLIC_WEB_BASE_URL
ARG NEXT_PUBLIC_SOURCE_REPOSITORY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_XLAYER_RPC_URL=$NEXT_PUBLIC_XLAYER_RPC_URL \
    NEXT_PUBLIC_REGISTRY_ADDRESS=$NEXT_PUBLIC_REGISTRY_ADDRESS \
    NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK=$NEXT_PUBLIC_REGISTRY_DEPLOYMENT_BLOCK \
    NEXT_PUBLIC_PAYOUT_ADDRESS=$NEXT_PUBLIC_PAYOUT_ADDRESS \
    NEXT_PUBLIC_WEB_BASE_URL=$NEXT_PUBLIC_WEB_BASE_URL \
    NEXT_PUBLIC_SOURCE_REPOSITORY=$NEXT_PUBLIC_SOURCE_REPOSITORY
RUN pnpm --filter @launchproof/frontend build

FROM node:24-alpine
ARG BUILD_COMMIT_SHA
LABEL org.opencontainers.image.revision=$BUILD_COMMIT_SHA
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
