## Why we needed this

- AGOL Notebooks could not reach `https://vpatlas.org:4322/...` directly. Non-standard ports are blocked or filtered by Esri's egress.
- Solution: front the API on standard 443 via a new nginx vhost at `api.vpatlas.org`, then point the notebook there.

## nginx setup (api.vpatlas.org)

DNS: `api.vpatlas.org` A record points to the same IP as `vpatlas.org`.

Config at `/etc/nginx/sites-available/api.vpatlas.org`, symlinked into `sites-enabled/`. Cert via `certbot --nginx`.

```nginx
server {
    listen 80;
    server_name api.vpatlas.org;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl;
    server_name api.vpatlas.org;
    client_max_body_size 25M;

    ssl_certificate /etc/letsencrypt/live/api.vpatlas.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.vpatlas.org/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass https://127.0.0.1:4322;
        proxy_ssl_verify off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Critical gotcha: Node app does its own TLS termination

The VPAtlas Node API on port 4322 is configured with `https.createServer({ key, cert }, app).listen(4322)` — it expects clients to speak HTTPS directly to it.

Symptoms when this is wrong:
- `curl http://127.0.0.1:4322/` → "Empty reply from server"
- nginx with `proxy_pass http://127.0.0.1:4322` → 502 Bad Gateway
- TCP connection succeeds, but the app drops it because it can't parse plain HTTP as TLS

Fix: in the nginx config, use `proxy_pass https://127.0.0.1:4322;` and add `proxy_ssl_verify off;` (the upstream cert won't validate against `127.0.0.1`). TLS is terminated twice (nginx ↔ Node), which is wasteful but harmless on loopback.

Cleaner long-term option (not yet done): change the Node app to plain `app.listen(4322)`, remove cert loading, and let nginx handle TLS at the edge — matches the `api.dev.vpatlas.org` → `:4010` pattern. Breaks any consumers still hitting `vpatlas.org:4322` directly.

### Diagnostic commands that pinpointed the issue

```bash
# What's listening?
sudo ss -tlnp | grep 4322
# → LISTEN ... *:4322 ... PM2 ... node    (app is up, bound to all interfaces)

# Plain HTTP fails — empty reply
curl -v http://127.0.0.1:4322/

# HTTPS works — confirms Node is TLS-terminating
curl -vk https://127.0.0.1:4322/
```

### Once api.vpatlas.org works, port 4322 can be closed publicly

The AWS security group rule allowing public 4322 is no longer needed — only nginx on the same box reaches it via 127.0.0.1, and loopback doesn't need a security group rule. Closing it reduces attack surface. Wait until any existing consumers are migrated to `api.vpatlas.org`.

## AGOL Notebook setup

Run inside ArcGIS Online (Notebook → New Notebook → Standard runtime). `GIS("home")` auto-authenticates because the notebook runs inside AGOL.

### One-time: create the feature layer

Run this **once** to create the initial AGOL items. Edit URL/title/tags first.

```python
from arcgis.gis import GIS
import requests, json, tempfile, os

gis = GIS("home")

API_URL = "https://api.vpatlas.org/mapped/geojson?mappedPoolStatus=Confirmed&mappedPoolStatus=Probable"
ITEM_TITLE = "VPAtlas Confirmed and Probable Pools"
ITEM_TAGS = "vce, vpatlas, biodiversity, vernal pools"
ITEM_SNIPPET = "VPAtlas Confirmed and Probable Pools"

resp = requests.get(API_URL)
resp.raise_for_status()

with tempfile.NamedTemporaryFile(mode="w", suffix=".geojson", delete=False) as f:
    json.dump(resp.json(), f)
    tmp_path = f.name

geojson_item = gis.content.add(
    item_properties={
        "title": ITEM_TITLE,
        "type": "GeoJson",
        "tags": ITEM_TAGS,
        "snippet": ITEM_SNIPPET,
    },
    data=tmp_path,
)
print(f"GeoJSON item created: {geojson_item.id}")

feature_layer_item = geojson_item.publish()
print(f"Feature layer published: {feature_layer_item.id}")
print(f"URL: {feature_layer_item.url}")

os.unlink(tmp_path)
```

This creates **two items** in AGOL Content:
- The **GeoJSON source item** — keep it, `overwrite()` needs it
- The **hosted feature layer** — used by maps and apps

Record both item IDs. Verify the feature layer in the AGOL Map Viewer (fields, geometry, popup) before scheduling refreshes — schema is set on first publish.

### Scheduled refresh

After the initial create works, **replace the cell contents** with this overwrite-only version. Same notebook, different code. Edit `GEOJSON_ITEM_ID` to the GeoJSON source item's ID (not the feature layer ID).

```python
from arcgis.gis import GIS
from arcgis.features import FeatureLayerCollection
import requests, json, tempfile, os

gis = GIS("home")

API_URL = "https://api.vpatlas.org/mapped/geojson?mappedPoolStatus=Confirmed&mappedPoolStatus=Probable"
GEOJSON_ITEM_ID = "PASTE_GEOJSON_SOURCE_ITEM_ID_HERE"

resp = requests.get(API_URL)
resp.raise_for_status()

with tempfile.NamedTemporaryFile(mode="w", suffix=".geojson", delete=False) as f:
    json.dump(resp.json(), f)
    tmp_path = f.name

item = gis.content.get(GEOJSON_ITEM_ID)
flc = FeatureLayerCollection.fromitem(item)
result = flc.manager.overwrite(tmp_path)
print(result)

os.unlink(tmp_path)
print("Done.")
```

Run it once manually to confirm. Save. Then schedule it (Content → notebook → Schedule, or the schedule icon in the notebook toolbar).

### Why the create-then-replace pattern

`overwrite()` only refreshes existing layers — it doesn't create them. The create code, if scheduled, would make new items every run. Splitting the workflow into a one-shot create + a scheduled overwrite avoids that.

## Multiple layers in one notebook

To refresh multiple layers in one scheduled run, loop over a list:

```python
layers_to_refresh = [
    {
        "name": "Confirmed/Probable Pools",
        "api_url": "https://api.vpatlas.org/mapped/geojson?mappedPoolStatus=Confirmed&mappedPoolStatus=Probable",
        "item_id": "GEOJSON_SOURCE_ITEM_ID_1",
    },
    {
        "name": "Other Pools",
        "api_url": "https://api.vpatlas.org/mapped/geojson?mappedPoolStatus=Other",
        "item_id": "GEOJSON_SOURCE_ITEM_ID_2",
    },
]

for layer in layers_to_refresh:
    print(f"Refreshing {layer['name']}...")
    resp = requests.get(layer["api_url"])
    resp.raise_for_status()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".geojson", delete=False) as f:
        json.dump(resp.json(), f)
        tmp_path = f.name
    item = gis.content.get(layer["item_id"])
    flc = FeatureLayerCollection.fromitem(item)
    result = flc.manager.overwrite(tmp_path)
    print(f"  → {result}")
    os.unlink(tmp_path)
```

## Constraints to know

- **`overwrite()` requires the original GeoJSON source item** to still exist in AGOL Content. Don't delete it.
- **Schema is locked at first publish.** If the API later returns new fields or different types, `overwrite()` will fail. Pin the API output schema before publishing.
- **CRS** must be WGS84 (EPSG:4326). Standard for GeoJSON; verify endpoint output.
- **AGOL Notebook outbound** is restricted to standard ports (80/443). Always front internal APIs through nginx on 443.