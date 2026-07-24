FROM node:24-alpine AS build
ARG BUILD_COMMIT_SHA
LABEL org.opencontainers.image.revision=$BUILD_COMMIT_SHA
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY fixtures/runtime fixtures/runtime
COPY fixtures/invoice-normalizer-invalid-output fixtures/invoice-normalizer-invalid-output
RUN pnpm install --filter @launchproof/fixture-invalid-output... --frozen-lockfile && pnpm --filter @launchproof/fixture-invalid-output... build
ENV PORT=4101 FIXTURE_BIND_HOST=0.0.0.0
EXPOSE 4101
CMD ["node", "fixtures/invoice-normalizer-invalid-output/dist/index.js"]
