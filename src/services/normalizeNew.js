// Normalization functions for weather stations, signs, and camera views

function extractLatLon(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return { lat: null, lon: null };
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return {
    lat: (minLat + maxLat) / 2,
    lon: (minLon + maxLon) / 2
  };
}

export function normalizeWeatherStations(graphqlResponse) {
  const data = graphqlResponse?.data?.listWeatherStationsQuery;
  if (!data || !Array.isArray(data.stations)) return [];

  return data.stations.map((station) => {
    const id = station.uri || `weather-station-${Date.now()}-${Math.random()}`;

    return {
      id,
      uri: station.uri || null,
      title: station.title || "",
      description: station.description || "",
      status: station.status || "UNKNOWN",
      color: station.color || "",
      icon: station.icon || "",
      route_designator: station.location?.routeDesignator || null,
      lat: null, // Weather stations typically don't have explicit lat/lon in the response
      lon: null,
      weather_fields: station.weatherStationFields || {},
      last_updated_timestamp: station.lastUpdated?.timestamp || null,
      raw: station
    };
  });
}

export function normalizeSigns(graphqlResponse) {
  const data = graphqlResponse?.data?.listSignsQuery;
  if (!data || !Array.isArray(data.signs)) return [];

  return data.signs.map((sign) => {
    const id = sign.uri || `sign-${Date.now()}-${Math.random()}`;
    const { lat, lon } = extractLatLon(sign.bbox);

    const bbox =
      Array.isArray(sign.bbox) && sign.bbox.length === 4
        ? {
            bbox_min_lon: sign.bbox[0],
            bbox_min_lat: sign.bbox[1],
            bbox_max_lon: sign.bbox[2],
            bbox_max_lat: sign.bbox[3]
          }
        : {
            bbox_min_lon: null,
            bbox_min_lat: null,
            bbox_max_lon: null,
            bbox_max_lat: null
          };

    return {
      id,
      uri: sign.uri || null,
      title: sign.title || "",
      city_reference: sign.cityReference || null,
      sign_display_type: sign.signDisplayType || null,
      sign_status: sign.signStatus || null,
      color: sign.color || "",
      icon: sign.icon || "",
      route_designator: sign.location?.routeDesignator || null,
      primary_linear_reference: sign.location?.primaryLinearReference || null,
      secondary_linear_reference: sign.location?.secondaryLinearReference || null,
      lat,
      lon,
      ...bbox,
      views: sign.views || [],
      gantry_signs: sign.gantrySigns || [],
      raw: sign
    };
  });
}

export function normalizeCameraViews(graphqlResponse) {
  const data = graphqlResponse?.data?.listCameraViewsQuery;
  if (!data || !Array.isArray(data.cameraViews)) return [];

  return data.cameraViews.map((view) => {
    const id = view.uri || `camera-view-${Date.now()}-${Math.random()}`;

    // Extract location from parent collection if available
    let lat = null;
    let lon = null;
    if (view.parentCollection?.location) {
      // Parent location might have coordinates in some field
      // For now, we'll leave this as null unless we find explicit coords
    }

    return {
      id,
      uri: view.uri || null,
      title: view.title || "",
      category: view.category || null,
      icon: view.icon || "",
      url: view.url || null,
      sources: view.sources || [],
      parent_uri: view.parentCollection?.uri || null,
      parent_title: view.parentCollection?.title || null,
      parent_icon: view.parentCollection?.icon || null,
      parent_color: view.parentCollection?.color || null,
      parent_route_designator: view.parentCollection?.location?.routeDesignator || null,
      lat,
      lon,
      last_updated_timestamp: view.lastUpdated?.timestamp || null,
      raw: view
    };
  });
}
