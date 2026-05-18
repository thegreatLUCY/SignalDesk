# Node 22 LTS pinned in-container (your host has Node 24; pinning keeps the
# build reproducible and independent of whatever you upgrade to later).
FROM node:22-alpine

WORKDIR /app

# Same layer-caching trick as the backend: install deps before copying source.
COPY package.json ./
RUN npm install

EXPOSE 3000

# Source is bind-mounted in docker-compose for hot reload.
CMD ["npm", "run", "dev"]
