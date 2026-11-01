# Plungee — Devvit (prototype)

The Reddit app is named **Plungee**. The **Devvit app slug** is `plungee-game` and the **repository/project** is `plungee-devvit`. This is an independent copy of the web game; the web repo is not changed.

## Current milestone: playable Devvit test post

- Vue 3 replaces the React example frontend in the official Devvit Web **0.15.1** starter.
- Inline post (`splash.html`) shows the challenge level and a **Play** button.
- Play opens `game.html` in expanded mode and **starts that post's level immediately**; no home-screen detour.
- The post's `levelKey` is bound in `postData` when the test post is created, and validated server-side.
- Original Plungee simulation, renderer, 67 campaign levels, audio, Character editor and Memphis light/dark themes are included.
- On finish, `/api/verify` deterministically simulates the replay on the Devvit server and persists an improved personal score for the authenticated Reddit user.
- Verified finishes are now persisted for the current Reddit user when `context.userId` is available. The browser never supplies identity data.
- Finishing shows **Continue in Campaign**, where levels can be played sequentially. Campaign/character visuals are from the web version. Device-local campaign progress, character, audio and own best replay are temporary migration defaults, **not Reddit-account-backed data**.
- A moderator's subreddit menu item **Create a Plungee test post** creates a test post; the app-install trigger also creates one.

## Requirements

- **Node.js 24** (see `.nvmrc`; the uploaded starter specifies 24.18.0).
- npm + Reddit/Devvit CLI login.
- Devvit App registered with slug `plungee-game`, displayed name **Plungee** (configured in developer portal).

## Run

```bash
npm install
npm run test:types
npm run build
npm run dev
```

`npm run dev` invokes `devvit playtest`. Use the generated test subreddit or install the app in a subreddit you moderate. Use the app's moderator menu action to create a playable post. The new app version is uploaded/published via the original starter scripts: `npm run deploy` and `npm run launch` — **do not publish until the social and privacy requirements are ready**.

`package-lock.json` is intentionally absent: the uploaded starter's lock contained incompatible/extraneous platform dependencies, and npm registry access was unavailable in the preparation environment. Run `npm install` locally with Node 24 to generate and commit the new lockfile before running `npm ci` or deploying.

## Code layout

- `src/client/Splash.vue` — compact inline post preview; direct `requestExpandedMode` on click
- `src/client/PlungeeApp.vue` — expanded play-first navigation
- `src/client/plungee` — retained simulation, assets, levels, GameView, CampaignView, CharacterView, renderer
- `src/server/routes/api.ts` — `/api/init` and replay verification
- `src/server/core/post.ts` — creation of a fixed-level **test** post
- `src/shared/api.ts` — typed API responses
- `devvit.json` — Reddit app configuration and entrypoints

## Explicitly not yet implemented

- User-level posts, score comments and the client UI for released leaderboards/top-five ghosts
- User ID–based persistence, retention/deletion and post deletion handlers
- Weekly post scheduler, frozen seven-day standings, creator's optional result/replay post and next-visit reminder
- UGC editor posting workflow (the browser editor and private links are **not** mounted in this milestone)
- Separate Devvit-specific privacy documentation and Reddit production approval

Do **not** treat the test post, client-side local best or the current `/api/verify` response as a complete production social feature. Personal scores and the first challenge/leaderboard API are now persisted when Reddit identity is available; result comments, custom user levels and the frontend leaderboard/ghost presentation remain open.

## Redis score foundation

`/api/verify` always simulates the submitted replay before it can be stored. For an authenticated Reddit request, `src/server/core/scores.ts` stores the best verified result using:

- `plungee:v1:post:<postId>:scores` — per-user score records for the post
- `plungee:v1:post:<postId>:leaderboard` — sorted-set foundation ordered by verified ticks
- `plungee:v1:user:<userId>:scores` — user index for future deletion and retention work

The user ID and display name come from server-side `context.userId` and `context.username`; neither is accepted from the client. Score records expire after 90 days. Each record also contains the validated `color`, `eyes`, `pattern` and `patternColor` snapshot used for that best run. If the user improves the time with another character, the snapshot is replaced. `/api/leaderboard` releases only the top five records, including character snapshots and replays, after the challenge's seven-day close timestamp; before that it returns no foreign results.

## Build status

The current workspace passes `npm run test:types` and `npm run build`. An on-Reddit playtest and deployment are still separate verification steps.
