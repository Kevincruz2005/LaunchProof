FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY fixtures/runtime fixtures/runtime
COPY fixtures/invoice-normalizer-invalid-output fixtures/invoice-normalizer-invalid-output
RUN pnpm install --filter @launchproof/fixture-invalid-output... --frozen-lockfile && pnpm --filter @launchproof/fixture-invalid-output... build
ENV PORT=4101
EXPOSE 4101
CMD ["node", "fixtures/invoice-normalizer-invalid-output/dist/index.js"]
