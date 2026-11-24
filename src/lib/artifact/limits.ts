// Time limits for generating an artifact. They depend on each other, so they live in one place.
// Order that must hold: model wait < function limit < claim expiry < browser give-up.
// (The route's `maxDuration` must be a literal for Next, so a unit test checks it against this file.)

/** How long we wait for the model before using the template fallback. */
export const MODEL_TIMEOUT_MS = 55_000;

/** The Vercel function limit, in seconds: model wait plus time to save the fallback. */
export const ROUTE_MAX_DURATION_SECONDS = 60;

/** A generation claim older than this is treated as dead (the function crashed or was killed). */
export const CLAIM_TTL_MS = 65_000;

/** The browser stops waiting after this many seconds and shows the failure state. */
export const CLIENT_GIVE_UP_SECONDS = 70;

// The goal cards are shorter than an artifact and the user waits on them with nothing else to look at, so they get less time:
// model wait 35 s, function limit 40 s (5 s to save, as above), browser gives up at 45 s.
export const GOALS_MODEL_TIMEOUT_MS = 35_000;
export const GOALS_ROUTE_MAX_DURATION_SECONDS = 40;
export const GOALS_CLIENT_TIMEOUT_MS = 45_000;
