FROM node:latest
RUN mkdir -p /opt/ui
WORKDIR /opt/ui

COPY ./ .
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN adduser --disabled-password ui
RUN chown -R ui:ui /opt/ui

USER ui
RUN npm install

# Build service workers with version injection
RUN node uiVPAtlas/explore/sw-build.js patch
RUN node uiVPAtlas/survey/sw-build.js patch

EXPOSE 8090

# Default env values (docker-compose overrides these)
ENV API_PROT=http
ENV API_HOST=localhost
ENV API_PORT=4010
ENV UI_PROT=http
ENV UI_HOST=localhost
ENV UI_PORT=8090

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
