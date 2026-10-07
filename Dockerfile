# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/package.json
COPY ui/package.json ui/package.json
COPY extension/package.json extension/package.json
RUN npm ci
COPY server server
COPY fixtures fixtures
RUN npm run build --workspace=server && npm prune --omit=dev
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
