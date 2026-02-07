FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
RUN npm install

# Copy source
COPY . .

# Expose dev server port
EXPOSE 5173

# Run dev server (accessible from outside container)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
