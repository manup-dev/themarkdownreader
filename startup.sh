#!/bin/bash
# md-reader startup script
# Starts the dev server on port 5183 (Docker or local)

set -e

PORT=5183

echo "🚀 Starting md-reader on port $PORT..."

# Check if port is already in use
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  echo "⚠️  Port $PORT is already in use. Run ./shutdown.sh first."
  exit 1
fi

# Docker mode: if docker-compose.yml exists and Docker is available
if command -v docker &>/dev/null && [ -f docker-compose.yml ]; then
  echo "🐳 Starting with Docker Compose..."
  docker compose up -d
  echo "✅ md-reader running at http://localhost:$PORT"
  echo "   Ollama running at http://localhost:11435"
  docker compose logs -f app
else
  # Local mode: npm dev server
  echo "📦 Starting local dev server..."
  npm run dev &
  echo $! > .dev-server.pid
  echo "✅ md-reader running at http://localhost:$PORT"
  echo "   PID saved to .dev-server.pid"
fi
