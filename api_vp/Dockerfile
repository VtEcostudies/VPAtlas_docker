FROM node:latest
RUN mkdir -p /opt/api
WORKDIR /opt/api
RUN adduser --disabled-password api
COPY ./ .
RUN chown -R api:api /opt/api
USER api
RUN npm install
EXPOSE 4010

# Default env values (docker-compose overrides these)
ENV DB_HOST=db_vp
ENV DB_PORT=5432
ENV DB_USER=postgres
ENV DB_PASSWORD=postgres
ENV DB_NAME=vpatlas

# Add script and install psql to enable wait-for-pg.sh
COPY wait-for-pg.sh /wait-for-pg.sh
USER root
# postgresql-client -> psql (wait-for-pg.sh)
# postgis           -> pgsql2shp / shp2pgsql, required by _helpers/db_shapefile.js
#                      for the /mapped|/visit|/survey /shapefile endpoints
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive \
    apt-get install --no-install-recommends --assume-yes \
      postgresql-client \
      postgis \
 && rm -rf /var/lib/apt/lists/*
RUN chmod +x /wait-for-pg.sh

# pgsql2shp writes to a relative 'shapefile/' dir under WORKDIR and will not
# create it; tarZip then cd's into it. Must exist and be writable by 'api'.
RUN mkdir -p /opt/api/shapefile && chown api:api /opt/api/shapefile

ENTRYPOINT ["./wait-for-pg.sh","node","server.js"]
USER api
