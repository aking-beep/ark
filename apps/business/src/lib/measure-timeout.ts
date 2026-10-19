/** Client-safe copy of the server budget in `measure.ts`. Do not import that file here. */
export const MEASURE_TIMEOUT_MS = 15_000;

/**
 * The browser waits longer than the server budget so the server's own
 * timeout response (and its cancellation of the provider call) arrives
 * first, instead of the client giving up on a run the server is still paying for.
 */
export const MEASURE_CLIENT_TIMEOUT_MS = MEASURE_TIMEOUT_MS + 5_000;
