FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY packages/passport-gate/package.json packages/passport-gate/package.json
RUN pnpm install --filter @launchproof/backend... --frozen-lockfile
COPY backend backend
COPY packages/passport-gate packages/passport-gate
COPY schema schema
RUN pnpm --filter @launchproof/passport-gate build && pnpm --filter @launchproof/backend exec prisma generate && pnpm --filter @launchproof/backend build

FROM node:24-alpine
ARG BUILD_COMMIT_SHA
LABEL org.opencontainers.image.revision=$BUILD_COMMIT_SHA
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/packages/passport-gate ./packages/passport-gate
COPY --from=build /app/schema ./schema
USER node
CMD ["sh", "-c", "if [ \"$BACKEND_MODE\" = \"read-only\" ]; then exec node backend/dist/index.js; else node backend/node_modules/prisma/build/index.js migrate deploy --schema backend/prisma/schema.prisma && exec node backend/dist/index.js; fi"]
