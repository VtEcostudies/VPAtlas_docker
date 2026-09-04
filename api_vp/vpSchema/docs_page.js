/*
  docs_page.js — Swagger UI over /openapi.json.

  Served from the API rather than added to the PWA under ui_vp/. This page is
  for GIS and data consumers reading the API from outside the app, it has no
  offline use, and putting it in the UI would mean precaching a page and a CDN
  bundle that field volunteers never open.
*/

const SWAGGER = 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.17.14';

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VPAtlas Public Feature API</title>
<link rel="stylesheet" href="${SWAGGER}/swagger-ui.min.css">
<style>
  body { margin: 0; background: #fafafa; }
  .topbar { display: none; }
  .vp-head { padding: 1.25rem 1.5rem; background: #14532d; color: #fff; font-family: system-ui, sans-serif; }
  .vp-head h1 { margin: 0 0 .35rem; font-size: 1.15rem; font-weight: 600; }
  .vp-head p { margin: 0; font-size: .85rem; opacity: .85; max-width: 62ch; line-height: 1.45; }
</style>
</head>
<body>
<div class="vp-head">
  <h1>VPAtlas Public Feature API</h1>
  <p>Vernal pool data published as GeoJSON, Esri shapefile and OGC API - Features.
     Within each group all three formats carry an identical field set and identical
     types, generated from one database-derived dictionary.</p>
</div>
<div id="swagger"></div>
<script src="${SWAGGER}/swagger-ui-bundle.min.js"></script>
<script>
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger',
    deepLinking: true,
    defaultModelsExpandDepth: 0,
    docExpansion: 'list'
  });
</script>
</body>
</html>
`;

module.exports = { HTML };
