import { fetch511Graphql } from "./fetch511.js";
import { DASHBOARD_QUERY, buildDashboardVariables } from "./queries.js";

export async function fetchDashboardCollections(layerSlugs) {
  const variables = buildDashboardVariables(layerSlugs);
  const json = await fetch511Graphql({ query: DASHBOARD_QUERY, variables });
  const collections = json?.data?.dashboardQuery?.collections;
  return Array.isArray(collections) ? collections : [];
}
