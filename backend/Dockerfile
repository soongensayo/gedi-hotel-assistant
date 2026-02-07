FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
RUN npm install

# Copy source
COPY . .

# Expose API port
EXPOSE 3001

# Run dev server with hot reload
CMD ["npm", "run", "dev"]
