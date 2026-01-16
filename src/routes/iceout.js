import { fetchIceOutData } from "../services/fetchIceOut.js";

const featureSchema = {
  type: "object",
  required: ["type", "geometry", "properties"],
  additionalProperties: false,
  properties: {
    type: { const: "Feature" },
    id: { type: ["number", "string"] },
    geometry: {
      type: "object",
      required: ["type", "coordinates"],
      additionalProperties: false,
      properties: {
        type: { const: "Point" },
        coordinates: {
          type: "array",
          minItems: 2,
          items: { type: "number" }
        }
      }
    },
    properties: {
      type: "object",
      additionalProperties: true
    }
  }
};

const featureCollectionSchema = {
  type: "object",
  required: ["type", "count", "features"],
  additionalProperties: false,
  properties: {
    type: { const: "FeatureCollection" },
    count: { type: "number" },
    features: { type: "array", items: featureSchema }
  }
};

export async function iceOutRoutes(app) {
  app.get(
    "/api/iceout",
    {
      schema: {
        response: {
          200: featureCollectionSchema,
          502: {
            type: "object",
            required: ["ok", "error"],
            additionalProperties: false,
            properties: {
              ok: { const: false },
              error: { const: "UPSTREAM_ERROR" }
            }
          }
        }
      }
    },
    async (_req, reply) => {
    try {
      const data = await fetchIceOutData();
      reply.header("Cache-Control", "public, max-age=300");
      return data;
    } catch (err) {
      app.log.error({ err }, "IceOut fetch failed");
      reply.code(502);
      return { ok: false, error: "UPSTREAM_ERROR" };
    }
    }
  );
}
