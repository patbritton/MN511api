# mn511-api

## Setup
```bash
npm install
cp .env.example .env
# edit .env (set CORS_ORIGIN and your desired bbox/zoom in src/services/ingest.js)
npm run dev
```

## Endpoints
- GET /health
- GET /v1/meta/status
- GET /v1/events (GeoJSON FeatureCollection)
- GET /v1/events?bbox=minLon,minLat,maxLon,maxLat
- GET /v1/events?category=CRASH
- GET /v1/events?severity=2
- GET /v1/events?min_severity=2
- GET /v1/events?max_severity=4
- GET /v1/events/:id (GeoJSON Feature)
- GET /v1/cameras (GeoJSON FeatureCollection)
- GET /api/incidents?bbox=minLon,minLat,maxLon,maxLat (GeoJSON FeatureCollection)
- GET /api/closures?bbox=minLon,minLat,maxLon,maxLat
- GET /api/cameras?bbox=minLon,minLat,maxLon,maxLat
- GET /api/plows?bbox=minLon,minLat,maxLon,maxLat
- GET /api/road-conditions?bbox=minLon,minLat,maxLon,maxLat
- GET /api/weather-events?bbox=minLon,minLat,maxLon,maxLat
- GET /api/alerts?bbox=minLon,minLat,maxLon,maxLat
- GET /api/rest-areas?bbox=minLon,minLat,maxLon,maxLat
- GET /api/weigh-stations?bbox=minLon,minLat,maxLon,maxLat
- GET /api/fueling-stations?bbox=minLon,minLat,maxLon,maxLat
- GET /api/rwss?bbox=minLon,minLat,maxLon,maxLat
- GET /traffic (GeoJSON FeatureCollection)
- GET /incidents (GeoJSON FeatureCollection)
- GET /cameras (GeoJSON FeatureCollection)
- GET /closures (GeoJSON FeatureCollection)
- GET /conditions (GeoJSON FeatureCollection)

## Notes
- GraphQL endpoint: `https://511mn.org/api/graphql`
- No auth headers required for the standard `mapFeaturesQuery` POST
- Queries are static and replayable; keep them in the API layer
- Camera image URLs returned by the API are read-only and ephemeral; link/proxy, do not scrape
- `/api/*` endpoints query MN511 directly using `layerSlugs` and require `bbox`; optional `zoom`
- You can override `layerSlugs` per endpoint using `LAYERS_*` env vars (see `.env.example`)

## One-time HAR extraction
```bash
node extract-graphql.js
```
Creates `extracted-graphql.json` from `511mn.org.har`.
