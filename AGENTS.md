# Plungee Devvit implementation rules

- This repository is for Devvit (app slug `plungee-game`); NEVER modify the separate Plungee web repository.
- Do not introduce Apinator, Netlify backends, client-supplied user IDs, or browser-generated player identities.
- All persistent scores and player data planned for Devvit MUST be associated server-side with `context.userId` and backed by Devvit Redis, including deletion/retention mechanisms.
- Verify every replay by simulating inputs on the server; do not trust browser-reported ticks/deaths.
- Do not expose other players' best-run routes or ghosts before challenge close.
- Creating Reddit posts or comments on behalf of users requires their explicit action and any applicable Devvit permissions.
- Preserve Plungee mechanics, theme variables, component conventions and mobile controls.
- Run both TypeScript type checks and production build, and explicitly report if unavailable or failing.
- A Devvit challenge post must open its level immediately; Campaign is offered AFTER playing.
- User result posts after seven days are optional and prompted in-game on next visit, not sent via unsolicited notifications.
