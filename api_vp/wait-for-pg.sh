#!/bin/sh
# wait-for-pg.sh - Wait for PostgreSQL to be ready before starting the API

set -e

until PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -c '\q'; do
  >&2 echo "Postgres is unavailable at $DB_HOST:$DB_PORT - sleeping..."
  sleep 2
done

>&2 echo "Postgres is ready - executing command"
exec "$@"
