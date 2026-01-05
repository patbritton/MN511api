// GraphQL queries for MN511 API

export const WEATHER_STATIONS_QUERY = `
query ($input: ListArgs!) {
  listWeatherStationsQuery(input: $input) {
    stations {
      uri
      title
      color
      icon
      description
      status
      weatherStationFields
      location {
        routeDesignator
      }
      lastUpdated {
        timestamp
        timezone
      }
    }
    totalRecords
    error {
      message
      type
    }
  }
}
`;

export const SIGNS_QUERY = `
query ($input: ListArgs!) {
  listSignsQuery(input: $input) {
    signs {
      __typename
      uri
      title
      cityReference
      bbox
      icon
      color
      signDisplayType
      signStatus
      location {
        primaryLinearReference
        secondaryLinearReference
        routeDesignator
      }
      gantrySigns {
        uri
        title
        bbox
        icon
        cityReference
        color
        signStatus
        signDisplayType
        views {
          uri
          category
          title
          icon
          __typename
          ... on SignComboView {
            imageUrl
            textJustification
            textLines
          }
          ... on SignTextView {
            textJustification
            textLines
          }
          ... on SignImageView {
            imageUrl
          }
          ... on SignOverlayView {
            travelTimes
            imageUrl
            imageLayout
          }
          ... on SignOverlayTPIMView {
            textLines
            imageUrl
          }
        }
      }
      views {
        uri
        title
        category
        __typename
        ... on SignComboView {
          imageUrl
          textJustification
          textLines
        }
        ... on SignTextView {
          textJustification
          textLines
        }
        ... on SignImageView {
          imageUrl
        }
        ... on SignOverlayView {
          travelTimes
          imageUrl
          imageLayout
        }
        ... on SignOverlayTPIMView {
          textLines
          imageUrl
        }
      }
    }
    totalRecords
    error {
      message
      type
    }
  }
}
`;

export const CAMERA_VIEWS_QUERY = `
query ($input: ListArgs!) {
  listCameraViewsQuery(input: $input) {
    cameraViews {
      category
      icon
      lastUpdated {
        timestamp
        timezone
      }
      title
      uri
      url
      sources {
        type
        src
      }
      parentCollection {
        title
        uri
        icon
        color
        bbox
        location {
          routeDesignator
        }
        lastUpdated {
          timestamp
          timezone
        }
      }
    }
    totalRecords
    error {
      message
      type
    }
  }
}
`;

export function buildListArgsVariables(bbox) {
  return {
    input: {
      west: bbox.west ?? -180,
      south: bbox.south ?? -85,
      east: bbox.east ?? 180,
      north: bbox.north ?? 85,
      classificationsOrSlugs: [],
      sortDirection: "DESC",
      sortType: "ROADWAY",
      freeSearchTerm: "",
      recordLimit: 1000,
      recordOffset: 0
    }
  };
}
