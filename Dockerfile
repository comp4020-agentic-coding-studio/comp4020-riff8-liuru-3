# syntax = docker/dockerfile:1

# better-sqlite3 needs a compiler to build its native binding; a builder stage
# with those tools, discarded before the runtime image, keeps that off the
# image that actually runs.
FROM node:24-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# The only path that survives a restart or redeploy (fly.toml mounts a volume
# here); the SQLite file lives on it.
ENV DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY docs ./docs
COPY README.md ./
EXPOSE 8080
CMD ["node", "src/server.ts"]
