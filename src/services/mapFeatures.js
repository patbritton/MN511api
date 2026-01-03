export const MAP_FEATURES_QUERY = `
query MapFeatures($input: MapFeaturesArgs!, $plowType: String) {
  mapFeaturesQuery(input: $input) {
    mapFeatures {
      bbox
      title
      tooltip
      uri
      features {
        id
        geometry
        properties
        type
      }
      ... on Cluster { maxZoom }
      ... on Sign { signDisplayType }
      ... on Event { priority }
      __typename
      ... on Camera {
        active
        views(limit: 5) { uri ... on CameraView { url } category }
      }
      ... on Plow {
        views(limit: 5, plowType: $plowType) { uri ... on PlowCameraView { url } category }
      }
    }
    error { message type }
  }
}
`;

export function buildMapFeaturesRequest({ bbox, zoom, layerSlugs, nonClusterableUris }) {
  const input = {
    north: bbox.north,
    south: bbox.south,
    east: bbox.east,
    west: bbox.west,
    zoom,
    layerSlugs,
    nonClusterableUris: nonClusterableUris ?? ["dashboard"]
  };

  return { query: MAP_FEATURES_QUERY, variables: { input, plowType: "plowCameras" } };
}
