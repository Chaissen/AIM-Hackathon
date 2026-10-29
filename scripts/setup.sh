#!/usr/bin/env bash
# One-time setup: Synapse config, containers, Matrix users, database schema, FHIR seed data, Matrix room + widget.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm exec tsx scripts/init-env.ts
[ -f .env ] && set -a && . ./.env && set +a

if [ ! -f docker/synapse/homeserver.yaml ]; then
  docker run --rm -v "$PWD/docker/synapse:/data" \
    -e SYNAPSE_SERVER_NAME=klinikum.example -e SYNAPSE_REPORT_STATS=no \
    matrixdotorg/synapse:latest generate
fi

if ! grep -q "# ordy-demo-settings\|# lotse-demo-settings" docker/synapse/homeserver.yaml; then
  # Closed demo network: no federation, no open registration, relaxed rate limits for the bot.
  sed -i.bak '/^trusted_key_servers:/,/server_name: "matrix.org"/d' docker/synapse/homeserver.yaml
  cat >> docker/synapse/homeserver.yaml <<'YAML'
# ordy-demo-settings
trusted_key_servers: []
suppress_key_server_warning: true
enable_registration: false
federation_domain_whitelist: []
rc_message: {per_second: 100, burst_count: 200}
rc_login:
  address: {per_second: 100, burst_count: 200}
  account: {per_second: 100, burst_count: 200}
  failed_attempts: {per_second: 100, burst_count: 200}
rc_joins:
  local: {per_second: 100, burst_count: 200}
rc_invites:
  per_room: {per_second: 100, burst_count: 200}
  per_user: {per_second: 100, burst_count: 200}
YAML
fi

docker compose up -d

echo "Waiting for Synapse ..."
until curl -fsS http://localhost:8008/health >/dev/null 2>&1; do sleep 2; done
echo "Waiting for Postgres ..."
until docker compose exec -T postgres pg_isready -U ordy -d ordy >/dev/null 2>&1; do sleep 2; done
echo "Waiting for HAPI FHIR (first start takes ~1 min) ..."
until curl -fsS http://localhost:8090/fhir/metadata >/dev/null 2>&1; do sleep 3; done
echo "Waiting for Keycloak and the idaustria-sim realm ..."
until curl -fsS http://localhost:8080/realms/idaustria-sim/.well-known/openid-configuration >/dev/null 2>&1; do sleep 2; done

register() {
  docker compose exec -T synapse register_new_matrix_user -c /data/homeserver.yaml \
    -u "$1" -p "$2" --no-admin --exists-ok http://localhost:8008
}
register "${MATRIX_HOFER_USER:-lena.hofer}" "${MATRIX_HOFER_PASSWORD:-hofer-demo-2026}"
register "${MATRIX_BOT_USER:-ordy}" "${MATRIX_BOT_PASSWORD:-ordy-demo-2026}"

pnpm db:migrate
pnpm fhir:seed
pnpm matrix:bootstrap

echo
echo "Setup done. Start ordy with: pnpm dev"
