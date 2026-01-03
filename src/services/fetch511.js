import { request } from "undici";
import { config } from "../config.js";

export async function fetch511Graphql({ query, variables = {} }) {
  const res = await request(config.mn511GraphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": config.mn511UserAgent
      // If you later need cookies/auth headers, add them here.
    },
    body: JSON.stringify({ query, variables })
  });

  const text = await res.body.text();
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`MN511 GraphQL HTTP ${res.statusCode}: ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`MN511 returned non-JSON: ${text.slice(0, 300)}`);
  }
}