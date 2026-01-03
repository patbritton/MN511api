import { config } from "../config.js";

export function purgeAndMark(db) {
  const now = new Date();
  const nowIso = now.toISOString();

  const staleCutoff = new Date(now.getTime() - config.staleAfterMinutes * 60_000).toISOString();
  const hardCutoff = new Date(now.getTime() - config.hardExpireMinutes * 60_000).toISOString();

  // Mark unseen events as cleared if they haven't been seen recently
  db.prepare(
    `UPDATE events
     SET status='cleared', last_updated_at=@now
     WHERE status='active' AND last_seen_at < @staleCutoff`
  ).run({ now: nowIso, staleCutoff });

  // Hard delete very old cleared/unknown events
  db.prepare(
    `DELETE FROM events
     WHERE last_seen_at < @hardCutoff`
  ).run({ hardCutoff });
}