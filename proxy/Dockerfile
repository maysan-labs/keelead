# Maysan Labs edge proxy for KeeLead.
#
# nginx plus openssl (to derive the htpasswd entry from the runtime env at container start).
# The htpasswd file is generated per start, never baked into the image: the password can be
# rotated by changing one env var and redeploying, and no plaintext lands in an image layer.
FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY proxy/default.conf /etc/nginx/conf.d/default.conf
COPY proxy/40-htpasswd.sh /docker-entrypoint.d/40-htpasswd.sh
RUN chmod +x /docker-entrypoint.d/40-htpasswd.sh
