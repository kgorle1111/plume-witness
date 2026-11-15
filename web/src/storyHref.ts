// Kept out of routes.ts for the same reason as demoHref.ts (Vite swaps in the base path only in a module it builds).
// intro=0: the story opens on Galena Park itself, without the globe fly-in (about 9 MB of map tiles).
export const STORY_HREF = `${import.meta.env.BASE_URL}?view=story&intro=0`
