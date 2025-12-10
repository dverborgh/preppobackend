# Use Node.js LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the TypeScript application
RUN npm run build

# Expose the API port
EXPOSE 8000

# Start the application
CMD [ "sh", "-c", "npm run migrate && npm start" ]
