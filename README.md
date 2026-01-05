# MN511 API

A comprehensive REST API for Minnesota 511 traffic, weather, and road condition data. Fetches data from the official MN511 GraphQL API, caches it in SQLite, and exposes clean RESTful endpoints with GeoJSON responses.

## Features

- 🚗 Traffic incidents, crashes, and closures
- 📹 Traffic cameras with video sources
- 🌡️ Road Weather Information Stations (RWIS) with detailed weather data
- 🚦 Digital Message Signs (DMS) with current messages
- ❄️ Snow plow locations
- 🛣️ Road conditions and weather events
- 🗺️ GeoJSON format for easy mapping
- ⚡ Fast SQLite caching with automatic updates
- 🔄 Scheduled data ingestion every 5 minutes
- 🌐 CORS support for web applications

## Setup

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Create a `.env` file** in the root of the project with the following content:
    ```
    MN511_GRAPHQL_URL=https://graphql.mn511.org/
    CORS_ORIGIN=http://localhost:8788,http://127.0.0.1:8788
    NODE_TLS_REJECT_UNAUTHORIZED=0
    ```
    *   `MN511_GRAPHQL_URL`: The official GraphQL endpoint for the MN511 API.
    *   `CORS_ORIGIN`: The origin(s) to allow for Cross-Origin Resource Sharing. The default frontend server runs on port `8788`.
    *   `NODE_TLS_REJECT_UNAUTHORIZED`: This is necessary to bypass the self-signed certificate error from the GraphQL endpoint in a development environment.

3.  **Start the development server:**
    ```bash
    npm run dev
    ```
    The API will be available at `http://localhost:8787`.

4.  **Start the frontend server** in a new terminal:
    ```bash
    node web/serve.js
    ```
    The web map will be available at `http://localhost:8788`.

## Endpoints

### Health & Status
- `GET /health` - Health check endpoint
- `GET /v1/meta/status` - API status and metadata

### Events (Cached in SQLite)
- `GET /v1/events` - All events (GeoJSON FeatureCollection)
- `GET /v1/events?bbox=minLon,minLat,maxLon,maxLat` - Events within bounding box
- `GET /v1/events?category=CRASH` - Filter by category (CRASH, INCIDENT, CLOSURE, etc.)
- `GET /v1/events?severity=2` - Filter by severity level
- `GET /v1/events?min_severity=2` - Minimum severity filter
- `GET /v1/events?max_severity=4` - Maximum severity filter
- `GET /v1/events/:id` - Single event by ID (GeoJSON Feature)
- `GET /v1/cameras` - Camera events

### Weather Stations (RWIS) 🌡️
Road Weather Information Stations with detailed weather data:

- `GET /v1/weather-stations` - All weather stations (GeoJSON FeatureCollection)
- `GET /v1/weather-stations?status=FREEZING` - Filter by status
- `GET /v1/weather-stations?route=I-94` - Filter by route
- `GET /v1/weather-stations/:id` - Single station by ID
- `GET /api/weather-stations?bbox=...` - Live data from MN511 GraphQL

**Weather data includes:**
- Air temperature, dew point, surface temperature
- Precipitation (rate, past 1/3/6/12/24 hours)
- Wind speed/direction (average and gusts)
- Visibility, relative humidity
- Surface conditions (dry/wet/icy/snow)

### Digital Message Signs 🚦
Highway message signs with current displayed content:

- `GET /v1/signs` - All signs (GeoJSON FeatureCollection)
- `GET /v1/signs?status=ACTIVE` - Filter by status
- `GET /v1/signs?route=I-35W` - Filter by route
- `GET /v1/signs?bbox=minLon,minLat,maxLon,maxLat` - Signs within bounding box
- `GET /v1/signs/:id` - Single sign by ID
- `GET /api/signs?bbox=...` - Live data from MN511 GraphQL

**Sign data includes:**
- Current message text lines
- Travel time displays
- Images/graphics shown on signs
- Gantry sign collections (overhead signs)

### Live Data (Direct from MN511 GraphQL)
These endpoints query MN511 in real-time and require `bbox` parameter:

- `GET /api/incidents?bbox=minLon,minLat,maxLon,maxLat` - Live incidents
- `GET /api/closures?bbox=...` - Live closures
- `GET /api/cameras?bbox=...` - Live camera feeds
- `GET /api/plows?bbox=...` - Live plow locations
- `GET /api/road-conditions?bbox=...` - Live road conditions
- `GET /api/weather-events?bbox=...` - Live weather events
- `GET /api/alerts?bbox=...` - Live alerts
- `GET /api/rest-areas?bbox=...` - Rest area information
- `GET /api/weigh-stations?bbox=...` - Weigh station information
- `GET /api/fueling-stations?bbox=...` - Fueling station information
- `GET /api/rwss?bbox=...` - RWIS data (legacy endpoint)

### Convenience Endpoints
Filtered views of active events:

- `GET /traffic` - Active traffic events (crashes, incidents, construction, closures)
- `GET /incidents` - Active crashes and incidents only
- `GET /cameras` - Active cameras
- `GET /closures` - Active closures
- `GET /conditions` - Active conditions (weather, plows)

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

## WordPress Integration

**Complete WordPress integration available** in the `wp/` directory:

### Enhanced MPLS Hub Plugin
- **Smart API synchronization** with unique identifier system
- **Auto-updates** existing alerts instead of creating duplicates
- **Auto-cleanup** of expired/resolved alerts
- **Frontend display components** with professional styling
- **Road-specific traffic views** for better organization
- **Weather stations and message signs** integration

### Quick Start
1. See **[wp/DOCS/QUICKSTART.md](wp/DOCS/QUICKSTART.md)** for 5-minute setup
2. See **[wp/DOCS/WORDPRESS_INTEGRATION.md](wp/DOCS/WORDPRESS_INTEGRATION.md)** for comprehensive guide
3. See **[wp/DOCS/WORDPRESS_IMPLEMENTATION_SUMMARY.md](wp/DOCS/WORDPRESS_IMPLEMENTATION_SUMMARY.md)** for technical details

### Features
- ✅ No duplicate alerts (unique ID tracking)
- ✅ Alert banner for homepage
- ✅ Traffic organized by road (I-94, I-35W, etc.)
- ✅ Weather stations with live RWIS data
- ✅ Message signs with current messages
- ✅ Hourly auto-sync
- ✅ Professional styling

## Web Map + Widget

The `web/` folder contains a Leaflet demo map and a JS widget.

Run locally:
```bash
node web/serve.js
```

Demo pages:
- `http://localhost:8788/` (full map)
- `http://localhost:8788/widget-demo.html`

## Data Sources

This API aggregates data from multiple MN511 GraphQL queries:

1. **mapFeaturesQuery** - Events, incidents, cameras, road conditions
2. **listWeatherStationsQuery** - RWIS data with detailed weather metrics
3. **listSignsQuery** - Digital message signs with current content
4. **listCameraViewsQuery** - Camera feeds with video sources

## Example Response

Weather Station GeoJSON:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "weather-station/93",
      "geometry": null,
      "properties": {
        "title": "I-535: Blatnik Bridge - Pier 20",
        "status": "FREEZING",
        "routeDesignator": "I-535",
        "weatherFields": {
          "TEMP_AIR_TEMPERATURE": {
            "fieldName": "Air Temp",
            "displayValue": "13° F",
            "inAlertState": false
          },
          "WIND_AVG_SPEED": {
            "fieldName": "Wind Speed (avg)",
            "displayValue": "7.6 mph"
          }
        }
      }
    }
  ]
}
```

## Development

```bash
npm run dev  # Start development server
npm start    # Production server
```

## License

MIT
