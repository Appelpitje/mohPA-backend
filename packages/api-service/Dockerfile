# mohPA API Service Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace configurations
COPY package.json package-lock.json* tsconfig.json ./

# Copy packages
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/api-service/package.json ./packages/api-service/

# Install dependencies
RUN npm ci || npm install

# Copy source files
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/api-service ./packages/api-service

# Build TypeScript
RUN npm run build --workspace=@mohpa/shared && \
    npm run build --workspace=@mohpa/db && \
    npm run build --workspace=@mohpa/api-service

# Production runner image
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=3000
ENV API_HOST=0.0.0.0

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/api-service/package.json ./packages/api-service/

RUN npm ci --omit=dev || npm install --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/src/migrations ./packages/db/dist/migrations
COPY --from=builder /app/packages/api-service/dist ./packages/api-service/dist

EXPOSE 3000

CMD ["node", "packages/api-service/dist/index.js"]
