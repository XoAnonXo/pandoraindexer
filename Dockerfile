# =============================================================================
# Anymarket Ponder Indexer Dockerfile
# =============================================================================
# Optimized build for Railway deployment

FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy source files
COPY . .

# Generate Ponder types from schema
RUN npm run codegen

# Build cron.ts to cron.js
RUN npx tsc cron.ts --outDir . --module commonjs --esModuleInterop --skipLibCheck

# Make start script executable
RUN chmod +x start.sh

# Set production environment
ENV NODE_ENV=production
ENV PORT=42069

# Expose GraphQL API port
EXPOSE 42069

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:42069/health || exit 1

# Start with custom script that includes cron
CMD ["sh", "/app/start.sh"]