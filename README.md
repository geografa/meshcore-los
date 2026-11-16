# MeshCore link profile 3D

Line-of-sight profile between two MeshCore nodes with a 3D first Fresnel zone, on Mapbox GL JS + React.
Node data and the radio/terrain model come from [meshcore-dev/map.meshcore.io](https://github.com/meshcore-dev/map.meshcore.io) (MIT).

## Run

```
npm install
cp .env.example .env     # add your Mapbox public token
npm run dev
```

Click two nodes (or shift+click any ground point), set each antenna height with the 2–100 m slider, read the margin, hover the chart to see the spot in 3D.
Links are shareable: the ends, heights (`ha` / `hb`) and radio settings live in the URL.

## Heights

Everything in the profile is metres above the **bare-ground DEM** (Mapterhorn), then the earth’s bulge is taken off with a 4/3 effective radius so the chart and the 3D zone match the model.

**Antennas** sit `ha` / `hb` metres above that ground at A and B (default 5 m, slider 2–100 m). That AGL is the mast on the chart, the tips of the Fresnel ellipsoid, and the start/end of the diffraction path. Taller masts also reduce **terminal clutter** loss (below).

**Trees** come from OpenFreeMap landcover. Forest pixels add up to **25 m** of canopy; that tapers from full height below 1000 m elevation to nothing at 2000 m (tree line). The **150 m** nearest each end is treated as a clearing, so trees next to the mast are not an obstacle.

**Buildings** are sampled only along the hop, from OpenFreeMap / OpenMapTiles `building` polygons at **z14** (`render_height`). That is OSM `height`, else `levels × 3.66`, else **5 m** when untagged. `hide_3d` outlines are skipped so parts are not double-counted. Buildings are solid from the ground up (no `render_min_height` cutout) and do **not** get the 150 m forest clearing.

Along the path, the obstacle top is **ground + max(trees, buildings)** — not the sum — so a roof in a wooded lot counts as whichever is taller. That top is what diffraction, first-Fresnel clearance, and the chart (gray buildings, green trees) all use. Rural hops stay at 0 m buildings.

**Terminal clutter** (sidebar checkbox, on by default) is separate: ITU-R P.2108 extra loss only at the two antennas, not along the path. OSM landuse at each end is suburban **10 m** or urban / trees / forest **15 m**. If the mast is below that height you pay diffraction-over-clutter dB; if it is at or above, that term is 0. This is not a 3D city mesh — buildings on the path are the sampled heights above.

## What is what

- `src/lib/*` started as a copy of the original site: `coverage-model.js` (terrain + land cover + building heights + diffraction + link budget, `computeProfile`), `mvt.js`, `nodes.js`, `config.js`, `utils.js`, `profile-chart.js` (canvas chart, Fresnel/clearance maths) and `coverage-worker.js`. Keep the upstream MIT copyright notice when you publish.
- `src/fresnel-layer.js` is the 3D part: a Mapbox custom layer (Three.js) with the Fresnel ellipsoid, masts and line of sight, coloured by clearance (clear / partly blocked / blocked).
- `src/App.jsx` wires the map, node picking, controls and the worker.
- Terrain: Mapterhorn terrarium tiles are used both for the model and as the map's 3D terrain (exaggeration 1, so the zone sits where the model measured it). Trees and building heights: OpenStreetMap via OpenFreeMap.

## Nodes API and CORS

The original site calls `https://map.meshcore.io/api/v1/nodes?binary=1&short=1` from its own origin. In dev, Vite proxies `/mc-api` to it. For production either set `VITE_NODES_API_URL` to a URL that allows your origin, or put the same rewrite (`/mc-api/*` to `https://map.meshcore.io/api/*`) in your host's proxy (Netlify/Vercel/Cloudflare rewrites, nginx).
