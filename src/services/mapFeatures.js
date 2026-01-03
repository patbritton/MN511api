export const MAP_FEATURES_QUERY = `
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

export function buildMapFeaturesVariables({ bbox, zoom, layerSlugs }) {
  return {
    input: {
      north: bbox.north,
      south: bbox.south,
      east: bbox.east,
      west: bbox.west,
      zoom,
      layerSlugs
    },
    plowType: "plowCameras"
  };
}
