FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The server uses only Node built-ins; the client is bundled into public/client.js.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/lks.db
COPY --from=build /app/package.json ./
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
