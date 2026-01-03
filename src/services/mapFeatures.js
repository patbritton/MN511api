export const MAP_FEATURES_QUERY = `
query MapFeatures($input: MapFeaturesArgs!) {
  mapFeaturesQuery(input: $input) {
    mapFeatures {
      title
      tooltip
      uri
      priority
      bbox
      features {
        id
        type
        geometry { type coordinates }
        properties {
          icon { url scaledSize { width height } }
          strokeColor
          fillColor
          zIndex
          priority
        }
      }
    }
    error { message type }
  }
}
`;

export const MAP_FEATURES_QUERY_PLOW = `
query MapFeatures($input: MapFeaturesArgs!, $plowType: String!) {
  mapFeaturesQuery(input: $input, plowType: $plowType) {
    mapFeatures {
      title
      tooltip
      uri
      priority
      bbox
      features {
        id
        type
        geometry { type coordinates }
        properties {
          icon { url scaledSize { width height } }
          strokeColor
          fillColor
          zIndex
          priority
        }
      }
    }
    error { message type }
  }
}
`;

export function buildMapFeaturesRequest({ bbox, zoom, layerSlugs }) {
  const input = {
    north: bbox.north,
    south: bbox.south,
    east: bbox.east,
    west: bbox.west,
    zoom,
    layerSlugs
  };

  if (layerSlugs.includes("plowCameras")) {
    return { query: MAP_FEATURES_QUERY_PLOW, variables: { input, plowType: "plowCameras" } };
  }

  return { query: MAP_FEATURES_QUERY, variables: { input } };
}
