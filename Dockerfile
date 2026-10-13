# Use the official Bun image
FROM oven/bun:1 AS base
WORKDIR /app

# Client build stage
FROM base AS client-builder
COPY client/package.json client/bun.lock* ./client/
RUN cd client && bun install --frozen-lockfile

COPY client ./client
RUN cd client && bun run build

# Server setup stage
FROM base AS server-setup
COPY server/package.json server/bun.lock* ./server/

# Remove unused native dependencies that would require build tools
# bun:sqlite replaces better-sqlite3
# Bun.password replaces bcrypt
# This avoids installing python/make/g++ in the container
RUN sed -i '/"better-sqlite3":/d' server/package.json \
    && sed -i '/"bcrypt":/d' server/package.json

# Install dependencies (ignoring the ones we removed)
RUN cd server && bun install --frozen-lockfile || bun install

# Final runtime stage
FROM oven/bun:1 AS release
WORKDIR /app

# Copy server node_modules from setup stage
COPY --from=server-setup /app/server/node_modules ./server/node_modules
COPY --from=server-setup /app/server/package.json ./server/package.json

# Copy source code
COPY server ./server

# Copy built client assets
COPY --from=client-builder /app/client/dist ./client/dist

# Create data directory
RUN mkdir -p /app/data

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

WORKDIR /app/server

# Run with Bun
CMD ["bun", "index.ts"]
