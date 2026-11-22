FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
RUN mkdir -p data/uploads
ENV PORT=3000 HOST=0.0.0.0 SERVER_MODE=main
EXPOSE 3000
CMD ["node", "src/index.js"]
