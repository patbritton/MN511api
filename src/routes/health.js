export async function healthRoutes(app) {
  app.get("/health", async () => {
    return { ok: true };
  });

  app.get("/v1/meta/status", async () => {
    const row = app.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN status='cleared' THEN 1 ELSE 0 END) as cleared
         FROM events`
      )
      .get();

    const lastSeen = app.db
      .prepare(`SELECT MAX(last_seen_at) as last_seen_at FROM events`)
      .get();

    return {
      ok: true,
      counts: row,
      last_seen_at: lastSeen?.last_seen_at ?? null
    };
  });
}