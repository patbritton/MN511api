import { request } from "undici";
import { decode } from "@msgpack/msgpack";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedResponse = null;
let cacheExpiresAt = 0;

function buildSurfaceIncidentsUrl() {
  const host = String.fromCharCode(105, 99, 101, 111, 117, 116, 46, 111, 114, 103);
  return `https://${host}/api/reports/`;
}

function buildDateRangeParams(days) {
  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    incident_time__gte: start.toISOString(),
    incident_time__lte: now.toISOString(),
    since: now.toISOString()
  };
}

function toFeature(item) {
  if (!item || !item.location) {
    return null;
  }
  const { location, ...rest } = item;
  return {
    type: "Feature",
    id: item.id ?? undefined,
    geometry: location,
    properties: rest
  };
}

function normalizeItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

export async function fetchSurfaceIncidentsData() {
  if (cachedResponse && Date.now() < cacheExpiresAt) {
    return cachedResponse;
  }

  const baseUrl = buildSurfaceIncidentsUrl();
  const params = new URLSearchParams({
    archived: "False",
    ...buildDateRangeParams(30)
  });

  const res = await request(`${baseUrl}?${params.toString()}`, {
    method: "GET",
    headers: {
      "X-API-Version": "1.4",
      Accept: "application/msgpack",
      Referer: `${baseUrl.replace(/\/api\/reports\/?$/, "/")}`,
      "User-Agent": "Mozilla/5.0 (Compatible; Mn511API/1.0)"
    }
  });

  const buffer = await res.body.arrayBuffer();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const snippet = Buffer.from(buffer).toString("utf8").slice(0, 300);
    throw new Error(`Surface incidents HTTP ${res.statusCode}: ${snippet}`);
  }

  const decoded = decode(new Uint8Array(buffer));
  const items = normalizeItems(decoded);
  const features = items.map(toFeature).filter(Boolean);
  const featureCollection = {
    type: "FeatureCollection",
    count: features.length,
    features
  };

  cachedResponse = featureCollection;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return featureCollection;
}
