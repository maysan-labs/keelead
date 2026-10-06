#!/bin/sh
# Generate the htpasswd file from the container's runtime environment, before nginx starts.
# (Every *.sh in /docker-entrypoint.d/ is executed by the nginx image's entrypoint.)
set -eu

: "${BASIC_AUTH_USER:?BASIC_AUTH_USER is required}"
: "${BASIC_AUTH_PASSWORD:?BASIC_AUTH_PASSWORD is required}"

printf '%s:%s\n' \
  "$BASIC_AUTH_USER" \
  "$(printf '%s' "$BASIC_AUTH_PASSWORD" | openssl passwd -apr1 -stdin)" \
  > /etc/nginx/htpasswd

# This script runs as root, but the nginx WORKER that reads the password file runs as
# `nginx`. A root-only file makes the worker answer 500 ("could not open password file")
# to every request that actually presents credentials, while requests without credentials
# still get a correct-looking 401 — so the gate looks like it works and does not.
chown root:nginx /etc/nginx/htpasswd 2>/dev/null || true
chmod 640 /etc/nginx/htpasswd
echo "auth-proxy: htpasswd written for user '$BASIC_AUTH_USER'"
