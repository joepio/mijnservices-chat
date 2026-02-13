#!/usr/bin/env bash
set -euo pipefail

echo "Building and starting MijnServices containers..."
docker compose build --pull
docker compose up -d --remove-orphans

echo "Container status:"
docker compose ps

echo "Recent app logs:"
docker compose logs --tail=60 app
