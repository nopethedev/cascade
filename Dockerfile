FROM node:20-alpine
WORKDIR /app

# sqlite3 ships no musl prebuild, so it compiles here; the toolchain is removed
# again after install to keep the runtime image small.
RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
RUN apk del .build-deps

# Media tooling is part of the image, not an optional runtime download. Alpine's
# FFmpeg build includes libx264, libx265, VP9, AV1, AAC, Opus, E-AC-3, libass and
# FFprobe. fontconfig + DejaVu give burned-in titles a predictable font fallback
# alongside the bundled Noto Sans JP face in assets/fonts.
RUN apk add --no-cache ffmpeg fontconfig ttf-dejavu && rm -rf /var/cache/apk/*

COPY . .
RUN mkdir -p data/uploads
ENV PORT=3000 HOST=0.0.0.0 SERVER_MODE=main \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe
EXPOSE 3000
CMD ["node", "src/index.js"]
