# VoroniX AI as its own web service. Build from the repository root:
#   docker build -f apps/voronix-ai/Dockerfile -t voronix-ai .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/voronix-ai/package.json apps/voronix-ai/
RUN npm ci
COPY apps/voronix-ai apps/voronix-ai
RUN npm run build -w apps/voronix-ai

FROM node:22-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app/apps/voronix-ai
COPY --from=build /app/apps/voronix-ai/package.json ./
COPY --from=build /app/apps/voronix-ai/dist ./dist
COPY --from=build /app/apps/voronix-ai/data ./data
COPY --from=build /app/apps/voronix-ai/reports ./reports
COPY --from=build /app/apps/voronix-ai/public ./public
EXPOSE 4000
USER node
CMD ["node", "dist/server.js"]
