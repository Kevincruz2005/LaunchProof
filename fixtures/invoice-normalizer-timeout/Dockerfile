FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY fixtures/runtime fixtures/runtime
COPY fixtures/invoice-normalizer-timeout fixtures/invoice-normalizer-timeout
RUN pnpm install --filter @launchproof/fixture-timeout... --frozen-lockfile && pnpm --filter @launchproof/fixture-timeout... build
ENV PORT=4103
EXPOSE 4103
CMD ["node", "fixtures/invoice-normalizer-timeout/dist/index.js"]
