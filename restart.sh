#!/bin/bash

# Restart Backend Script
# Kills any running backend processes and starts fresh

echo "🛑 Stopping any running backend processes..."

# Kill any process using port 8000
lsof -ti:8000 | xargs kill -9 2>/dev/null

# Kill any node processes running the backend
pkill -f "ts-node-dev.*src/index.ts" 2>/dev/null
pkill -f "node.*dist/index.js" 2>/dev/null

echo "✅ Backend processes stopped"

# Wait a moment for ports to free up
sleep 2

echo "🚀 Starting backend..."

# Start the backend in development mode
cd /home/mrpluvid/preppo/backend && npm run dev 2>&1 &

echo "✅ Backend starting..."
echo "📝 Check logs with: cd /home/mrpluvid/preppo/backend && npm run dev"
