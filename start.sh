#!/usr/bin/env bash
set -e

MODE=${MODE:-wasm}
echo "Starting demo in MODE=${MODE}"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose up --build
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose up --build
else
  if [ -f package-lock.json ]; then
    npm ci || npm install
  else
    npm install
  fi
  npm start
fi


