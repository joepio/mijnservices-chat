FROM node:20-bookworm AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY frontend/package.json frontend/

RUN pnpm install --frozen-lockfile
RUN pnpm --dir frontend install --no-frozen-lockfile

COPY src ./src
COPY frontend ./frontend

RUN pnpm run build

FROM node:20-bookworm AS runtime

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist
RUN mkdir -p /app/data/images

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/server.js"]
