FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace and package files
COPY package.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/fesl-engine/package.json packages/fesl-engine/tsconfig.json packages/fesl-engine/

# Install dependencies
RUN npm install

# Copy source code
COPY packages/shared packages/shared
COPY packages/fesl-engine packages/fesl-engine

# Build packages
RUN npm run build --workspace=@mohpa/shared
RUN npm run build --workspace=@mohpa/fesl-engine

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy root package files
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/fesl-engine/package.json packages/fesl-engine/

# Install production dependencies only
RUN npm install --omit=dev

# Copy compiled files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/fesl-engine/dist ./packages/fesl-engine/dist

EXPOSE 18270 18051 18275 18056 9999

CMD ["node", "packages/fesl-engine/dist/main.js"]
