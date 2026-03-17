FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache curl
RUN npm install --production

COPY . .

# Since .env is in the root, and we copy api/ folder, 
# we should make sure the app doesn't crash if .env is missing 
# because variables are passed via docker-compose.
ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
