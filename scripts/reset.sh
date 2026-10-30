#!/usr/bin/env bash
# Resets the local demo data before a run or the pitch: Postgres (requests, audit log) and HAPI FHIR.
# Matrix users and the room stay. Run `pnpm dev` again afterwards if it was running.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Emptying Postgres ..."
docker compose exec -T postgres psql -q -U ordy -d ordy -v ON_ERROR_STOP=1 \
  -c "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;"

echo "Recreating HAPI FHIR (its data lives in the container) ..."
docker compose up -d --force-recreate hapi >/dev/null

echo "Waiting for HAPI FHIR ..."
until curl -fsS http://localhost:8090/fhir/metadata >/dev/null 2>&1; do sleep 3; done

pnpm db:migrate
pnpm fhir:seed
echo "Reset done."
