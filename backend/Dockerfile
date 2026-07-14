FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY backend/package.json backend/package.json
RUN pnpm install --filter @launchproof/backend... --frozen-lockfile
COPY backend backend
COPY schema schema
RUN pnpm --filter @launchproof/backend exec prisma generate && pnpm --filter @launchproof/backend build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/schema ./schema
USER node
CMD ["sh", "-c", "node backend/node_modules/prisma/build/index.js migrate deploy --schema backend/prisma/schema.prisma && node backend/dist/index.js"]
