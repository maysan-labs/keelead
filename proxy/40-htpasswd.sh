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

chmod 640 /etc/nginx/htpasswd
echo "auth-proxy: htpasswd written for user '$BASIC_AUTH_USER'"
