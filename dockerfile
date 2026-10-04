FROM node:20-slim

WORKDIR /app

# Copy package manifests first for Docker layer caching
COPY package*.json ./

# Install dependencies (Express, Sharp, omggif)
RUN npm install

# Copy all project files (server4.js, index4.html, etc.)
COPY . .

EXPOSE 3000

CMD ["node", "server4.js"]