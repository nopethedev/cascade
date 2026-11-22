FROM node:20-alpine
WORKDIR /app

# sqlite3 ships no musl prebuild, so it compiles here; the toolchain is removed
# again after install to keep the runtime image small.
RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
RUN apk del .build-deps

COPY . .
RUN mkdir -p data/uploads
ENV PORT=3000 HOST=0.0.0.0 SERVER_MODE=main
EXPOSE 3000
CMD ["node", "src/index.js"]
