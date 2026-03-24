#!/bin/sh
# Wait for Ollama server to be ready, then pull required models
set -e

echo "Waiting for Ollama to start..."
until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  sleep 1
done

echo "Ollama is ready. Pulling models..."

# Pull the default model
curl -sf http://localhost:11434/api/pull -d '{"name":"qwen2.5:1.5b"}' | tail -1
echo "qwen2.5:1.5b ready"

# Warm the model into VRAM
echo "Warming model into GPU..."
curl -sf http://localhost:11434/api/chat -d '{"model":"qwen2.5:1.5b","messages":[{"role":"user","content":"hi"}],"stream":false,"keep_alive":"30m"}' > /dev/null 2>&1
echo "Model loaded into VRAM and ready."
