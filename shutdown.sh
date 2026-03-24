#!/bin/bash
# md-reader shutdown script
# Stops the dev server (Docker or local)

set -e

PORT=5183

echo "🛑 Stopping md-reader..."

# Docker mode
if command -v docker &>/dev/null && [ -f docker-compose.yml ]; then
  if docker compose ps --quiet 2>/dev/null | head -1 | grep -q .; then
    echo "🐳 Stopping Docker Compose services..."
    docker compose down
    echo "✅ Docker services stopped."
  fi
fi

# Local mode: kill by PID file
if [ -f .dev-server.pid ]; then
  PID=$(cat .dev-server.pid)
  if kill -0 "$PID" 2>/dev/null; then
    echo "📦 Stopping local dev server (PID $PID)..."
    kill "$PID"
    echo "✅ Local server stopped."
  fi
  rm -f .dev-server.pid
fi

# Fallback: kill any process on the port
if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
  echo "⚠️  Port $PORT still in use. Killing remaining process..."
  fuser -k "$PORT/tcp" 2>/dev/null || true
  echo "✅ Port $PORT freed."
fi

echo "🏁 md-reader shutdown complete."
