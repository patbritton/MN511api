# MN511 API Documentation

This is a complete guide to the MN511 HTTP API only. It covers endpoints, parameters, response shapes, and best practices for both beginners and advanced users.

## Overview

The API exposes Minnesota 511 traffic, weather, and road condition data in GeoJSON.

Two data modes are available:

- Cached data in SQLite under `/v1/*` and convenience endpoints like `/traffic` (fast, stable).
- Live data proxied directly from the MN 511 GraphQL source under `/api/*` (requires `bbox`).

Base URL (local):

- `http://localhost:8787`

Public home:

- https://511.mp.ls
- https://mp.ls

## Disclaimer and data sources

This is an unofficial API and is not associated with or endorsed by the State of Minnesota or MnDOT.

511 is a public service of the Minnesota Department of Transportation (MnDOT) that provides traveler information via phone and the web (https://511mn.org). The source data can change rapidly and is provided as a public service.

From the official 511 MN disclaimer (https://511mn.org/help/About.html):

- Weather and road conditions change rapidly and should not be the only factor in travel decisions.
- Reports are based on information available at the time of preparation and cannot be guaranteed for accuracy or timeliness; actual conditions may vary.
- Data is provided by MnDOT field crews with additional sources including Minnesota State Patrol, National Weather Service, and the Road Weather Information System.

Use this API at your own risk and verify conditions through official channels when safety is involved.

## Authentication and rate limits

- No authentication required.
- Default rate limit: 300 requests per minute per client.

## Response format

All endpoints return JSON. List endpoints typically return GeoJSON `FeatureCollection` objects:

```json
{
  "ok": true,
  "count": 123,
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "event/123",
      "geometry": { "type": "Point", "coordinates": [-93.1, 44.98] },
      "properties": {
        "category": "CRASH",
        "severity": 3,
        "status": "active"
      }
    }
  ]
}
```

Cached event lists include `meta`:

```json
{
  "meta": {
    "max_source_version": 123456,
    "last_modified": "Mon, 05 Jan 2026 20:55:10 GMT"
  }
}
```

## GeoJSON notes

- Coordinates are `[lon, lat]`.
- Some features have `geometry: null` but may include `bbox`.
- Some line features are returned as `LineString` when live data includes line geometry.

## Common query parameters

Shared parameters:

- `limit` (number, default 200, max 1000): page size for cached lists.
- `offset` (number, default 0): pagination offset for cached lists.
- `bbox` (minLon,minLat,maxLon,maxLat): bounding box filter. Required on live `/api/*` endpoints.
- `zoom` (number): optional map zoom; affects live `/api/*` queries.

Example bbox: `-93.6,44.6,-92.8,45.2`

## Endpoints summary

Health:

- `GET /health`
- `GET /v1/meta/status`

Cached events and convenience:

- `GET /v1/events`
- `GET /v1/events/:id`
- `GET /v1/cameras`
- `GET /traffic`
- `GET /incidents`
- `GET /cameras`
- `GET /closures`
- `GET /conditions`

Cached weather stations and signs:

- `GET /v1/weather-stations`
- `GET /v1/weather-stations/:id`
- `GET /v1/signs`
- `GET /v1/signs/:id`

Live upstream (`bbox` required):

- `GET /api/plows`
- `GET /api/road-conditions`
- `GET /api/weather-events`
- `GET /api/rest-areas`
- `GET /api/weigh-stations`
- `GET /api/fueling-stations`
- `GET /api/rwss`
- `GET /api/weather-stations`
- `GET /api/signs`

Cached equivalents under `/api`:

- `GET /api/incidents`
- `GET /api/closures`
- `GET /api/cameras`
- `GET /api/alerts`

## Cached events (`/v1` and convenience)

`GET /v1/events` returns all cached events, sorted by status, severity, priority, and last update. The convenience endpoints are filters over the same data.

Event filters:

- `category` (string or comma list): common values include `CRASH,INCIDENT,CLOSURE,CONSTRUCTION,WEATHER,PLOW,CAMERA,CONDITION`
- `status` (string): common values include `active` and `cleared`
- `severity`, `min_severity`, `max_severity` (number)
- `since_version` (number): `source_version` greater than this
- `since_updated_at` (ISO date/time or epoch seconds/ms): `last_updated_at` greater than this
- `since_source_updated_timestamp` (number): `source_updated_timestamp` greater than this
- `bbox` (minLon,minLat,maxLon,maxLat)

Event properties (common fields):

- `uri`, `title`, `tooltip`
- `category`, `status`, `severity`, `priority`
- `road`, `direction`
- `source`, `source_id`, `source_version`
- `source_updated_at`, `source_updated_timestamp`
- `first_seen_at`, `last_seen_at`, `last_updated_at`
- `icon`
- `cameraViews` (only on camera endpoints)

Example: active incidents since a timestamp:

```bash
curl "http://localhost:8787/v1/events?category=CRASH,INCIDENT&status=active&since_updated_at=2026-01-05T20:00:00Z"
```

## Cached weather stations (`/v1/weather-stations`)

Filters:

- `status` (string)
- `route` (string, like `I-94`)
- `bbox` (minLon,minLat,maxLon,maxLat)

Weather station properties include:

- `title`, `description`
- `status`, `color`, `icon`
- `routeDesignator`
- `weatherFields` (object of fields like air temperature, wind, visibility)
- `lastUpdatedAt`, `lastUpdatedTimestamp`

Example:

```bash
curl "http://localhost:8787/v1/weather-stations?route=I-94"
```

## Cached signs (`/v1/signs`)

Filters:

- `status` (string)
- `route` (string, like `I-35W`)
- `bbox` (minLon,minLat,maxLon,maxLat)

Sign properties include:

- `title`, `cityReference`
- `signDisplayType`, `signStatus`
- `routeDesignator`
- `primaryLinearReference`, `secondaryLinearReference`
- `views` (array of current messages)
- `gantrySigns` (array of related signs)

Example:

```bash
curl "http://localhost:8787/v1/signs?status=ACTIVE"
```

## Live upstream data (`/api`)

Live endpoints require `bbox`. Many return the same feature shape as cached endpoints, but with live data.

Example:

```bash
curl "http://localhost:8787/api/road-conditions?bbox=-93.6,44.6,-92.8,45.2&zoom=10"
```

## Conditional requests and caching

Cached event lists and event detail responses include `ETag` and `Last-Modified` headers. You can use conditional requests to reduce bandwidth:

```bash
curl -H "If-None-Match: W/\"123-abc\"" http://localhost:8787/v1/events
```

If the data is unchanged, the API replies with `304 Not Modified`.

## Errors

Typical error responses:

```json
{ "ok": false, "error": "INVALID_BBOX" }
```

Common codes:

- `400 INVALID_BBOX` - Missing or invalid `bbox` on live endpoints.
- `404 NOT_FOUND` - Resource ID not found.
- `500 LAYER_MAP_MISSING` - Server misconfiguration for a live layer.

## Examples

Beginner (fetch in browser):

```js
const url = "http://localhost:8787/v1/events?category=CRASH,INCIDENT&status=active";
const res = await fetch(url);
const data = await res.json();
console.log(data.features.length);
```

Beginner (curl):

```bash
curl "http://localhost:8787/v1/weather-stations?route=I-94"
```

Advanced (incremental sync by version):

```bash
curl "http://localhost:8787/v1/events?since_version=150000&limit=1000"
```

Advanced (incremental sync by timestamp):

```bash
curl "http://localhost:8787/v1/events?since_updated_at=1700000000000"
```

Advanced (camera views):

```bash
curl "http://localhost:8787/v1/cameras"
```

## Configuration notes

- `EXPOSE_RAW=true` adds a `raw` field to feature properties for debugging.
- `LAYERS_*` env vars override live layer slugs for `/api/*` endpoints.
- `INGEST_*` cron env vars control cache refresh intervals.

See `.env.example` for the full list.
