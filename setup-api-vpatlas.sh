#!/bin/bash
# setup-api-vpatlas.sh
# Creates nginx reverse proxy for api.vpatlas.org → localhost:4322 with HTTPS

set -e

DOMAIN="api.vpatlas.org"
UPSTREAM_PORT="4322"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}"
NGINX_LINK="/etc/nginx/sites-enabled/${DOMAIN}"
CERT_EMAIL="jloomis@vtecostudies.org"   # ← change if you want a different contact

# Must run as root
if [ "$EUID" -ne 0 ]; then
    echo "Run with sudo." >&2
    exit 1
fi

# Confirm DNS resolves before bothering certbot
echo "→ Checking DNS for ${DOMAIN}..."
if ! host "${DOMAIN}" > /dev/null 2>&1; then
    echo "WARNING: ${DOMAIN} does not resolve yet. Cert issuance will fail." >&2
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

# 1. Write the nginx config (HTTP-only first; certbot will add HTTPS)
echo "→ Writing ${NGINX_CONF}..."
cat > "${NGINX_CONF}" <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:${UPSTREAM_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# 2. Symlink into sites-enabled
echo "→ Enabling site..."
if [ -L "${NGINX_LINK}" ]; then
    echo "  (symlink already exists)"
else
    ln -s "${NGINX_CONF}" "${NGINX_LINK}"
fi

# 3. Test config and reload before requesting cert
echo "→ Testing nginx config..."
nginx -t

echo "→ Reloading nginx..."
systemctl reload nginx

# 4. Get the cert. --nginx plugin will rewrite the conf to add the 443 block
#    and the http→https redirect automatically.
echo "→ Requesting Let's Encrypt cert for ${DOMAIN}..."
certbot --nginx \
    -d "${DOMAIN}" \
    --non-interactive \
    --agree-tos \
    --email "${CERT_EMAIL}" \
    --redirect

# 5. Final reload (certbot usually reloads itself, but doesn't hurt)
echo "→ Reloading nginx..."
nginx -t
systemctl reload nginx

echo
echo "✓ Done. Test with:"
echo "    curl -v https://${DOMAIN}/"