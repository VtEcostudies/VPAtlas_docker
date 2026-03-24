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
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive \
    apt-get install --no-install-recommends --assume-yes \
      postgresql-client
RUN chmod +x /wait-for-pg.sh

ENTRYPOINT ["./wait-for-pg.sh","node","server.js"]
USER api
