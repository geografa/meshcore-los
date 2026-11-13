# MeshCore link profile 3D

Line-of-sight profile between two MeshCore nodes with a 3D first Fresnel zone, on Mapbox GL JS + React.
Node data and the radio/terrain model come from [meshcore-dev/map.meshcore.io](https://github.com/meshcore-dev/map.meshcore.io) (MIT).

## Run

```
npm install
cp .env.example .env     # add your Mapbox public token
npm run dev
```

Click two nodes (or shift+click any ground point), pick antenna heights, read the margin, hover the chart to see the spot in 3D.
Links are shareable: the ends, heights and radio settings live in the URL.

## What is what

- `src/lib/*` is copied from the original site: `coverage-model.js` (terrain + land cover + diffraction + link budget, `computeProfile`), `mvt.js`, `nodes.js`, `config.js`, `utils.js`, `profile-chart.js` (canvas chart, Fresnel/clearance maths) and `coverage-worker.js`. Only the `msgpackr` import and the nodes API URL were changed. Keep the upstream MIT copyright notice when you publish.
- `src/fresnel-layer.js` is the 3D part: a Mapbox custom layer (Three.js) with the Fresnel ellipsoid, masts and line of sight, coloured by clearance (clear / partly blocked / blocked).
- `src/App.jsx` wires the map, node picking, controls and the worker.
- Terrain: Mapterhorn terrarium tiles are used both for the model and as the map's 3D terrain (exaggeration 1, so the zone sits where the model measured it). Trees and buildings: OpenFreeMap land cover.

## Nodes API and CORS

The original site calls `https://map.meshcore.io/api/v1/nodes?binary=1&short=1` from its own origin. In dev, Vite proxies `/mc-api` to it. For production either set `VITE_NODES_API_URL` to a URL that allows your origin, or put the same rewrite (`/mc-api/*` to `https://map.meshcore.io/api/*`) in your host's proxy (Netlify/Vercel/Cloudflare rewrites, nginx).
