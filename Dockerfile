# VoroniX AI as a web service: docker build -t voronix-ai . && docker run -p 4000:4000 voronix-ai
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src src
COPY scripts scripts
COPY data data
COPY reports reports
COPY public public
# The server, and the VoroniX AI site it shows at /live.
RUN npm run build && npm run build:demo

FROM node:22-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-demo ./dist-demo
COPY data ./data
COPY reports ./reports
COPY public ./public
EXPOSE 4000
USER node
CMD ["node", "dist/server.js"]
