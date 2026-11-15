// Kept out of routes.ts: Vite only swaps in the base path for the exact expression import.meta.env.BASE_URL,
// and routes.ts must stay loadable under plain Node for npm test.
export const DEMO_REPLAY_HREF = `${import.meta.env.BASE_URL}?intro=0#detect`
