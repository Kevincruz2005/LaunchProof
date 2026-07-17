FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY fixtures/runtime fixtures/runtime
COPY fixtures/invoice-normalizer-healthy fixtures/invoice-normalizer-healthy
RUN pnpm install --filter @launchproof/fixture-healthy... --frozen-lockfile && pnpm --filter @launchproof/fixture-healthy... build
ENV PORT=4100 FIXTURE_BIND_HOST=0.0.0.0
EXPOSE 4100
CMD ["node", "fixtures/invoice-normalizer-healthy/dist/index.js"]
