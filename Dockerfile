FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts/migrate.ts scripts/seed.ts scripts/evaluate-ai.ts ./scripts/
COPY scripts/evaluation ./scripts/evaluation
COPY db ./db
RUN mkdir -p docs/evidence && chown node:node docs/evidence
USER node
EXPOSE 3001
CMD ["npm","start"]
