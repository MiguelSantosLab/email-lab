FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy dependency definitions first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application source code
COPY server4.js ./
COPY index4.html ./

# Expose the application port (adjust if server4.js uses a different port)
EXPOSE 3000

# Start the application
CMD ["node", "server4.js"]