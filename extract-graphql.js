const fs = require("fs");

const har = JSON.parse(fs.readFileSync("511mn.org.har", "utf8"));
const queries = new Map();

har.log.entries.forEach((entry) => {
  if (
    entry.request.url === "https://511mn.org/api/graphql" &&
    entry.request.postData &&
    entry.request.postData.text
  ) {
    try {
      const body = JSON.parse(entry.request.postData.text);
      const payloads = Array.isArray(body) ? body : [body];

      payloads.forEach((p) => {
        if (p.query) {
          const key = p.query.replace(/\s+/g, " ").trim();
          queries.set(key, {
            query: p.query,
            variables: p.variables || null
          });
        }
      });
    } catch (_) {
      // ignore malformed
    }
  }
});

fs.writeFileSync(
  "extracted-graphql.json",
  JSON.stringify([...queries.values()], null, 2)
);

console.log(`Extracted ${queries.size} unique GraphQL queries`);
