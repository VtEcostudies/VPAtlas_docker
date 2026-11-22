FROM postgis/postgis:17-3.5

# This image used to `apt-get install gdal-bin`. Nothing uses it (no ogr2ogr /
# gdal call anywhere in the api, migrations or scripts), and the base image is
# Debian 11 (bullseye), which reached end of life in Aug 2026: its pgdg and
# security apt repos now 404, so any uncached build failed. With no apt step,
# the build is just the upstream image and needs no package repos at all.

EXPOSE 5432
