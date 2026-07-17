FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY fixtures/runtime fixtures/runtime
COPY fixtures/invoice-normalizer-schema-drift fixtures/invoice-normalizer-schema-drift
RUN pnpm install --filter @launchproof/fixture-schema-drift... --frozen-lockfile && pnpm --filter @launchproof/fixture-schema-drift... build
ENV PORT=4102 FIXTURE_BIND_HOST=0.0.0.0
EXPOSE 4102
CMD ["node", "fixtures/invoice-normalizer-schema-drift/dist/index.js"]
