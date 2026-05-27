FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build
CMD ["node", "dist/index.js"]
