# syntax=docker/dockerfile:1

FROM node:24.14.1-alpine3.23 AS verification
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY test ./test
COPY scripts ./scripts
RUN npm test

FROM node:24.14.1-alpine3.23 AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=verification --chown=node:node /app/package.json ./package.json
COPY --from=verification --chown=node:node /app/src ./src
COPY --from=verification --chown=node:node /app/scripts ./scripts
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
