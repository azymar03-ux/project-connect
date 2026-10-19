FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG INTERNAL_API_URL=http://api:3001
ENV INTERNAL_API_URL=$INTERNAL_API_URL
RUN npm run db:generate && npm run build:api && npm run build
ENV NODE_ENV=production
RUN mkdir -p /data/files && chown -R node:node /data /app
USER node
EXPOSE 3000 3001
CMD ["npm", "run", "start:web"]
