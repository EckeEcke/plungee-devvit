# Plungee

**Fall fast. Land smart.**

Plungee is a precision platformer played directly on Reddit. Steer left or right, use momentum and time your way through moving hazards. Play the campaign, compete in weekly challenges, customize your character or build levels for your community.

This repository contains the Devvit app **Plungee**, registered as `plungee-game`.

## Play

- **Campaign:** 75 levels across Easy, Normal and Hard, with medals, personal bests and an optional ghost of your own best run.
- **Weekly Challenge:** a shared level with seven days to set your fastest verified time.
- **Community levels:** play levels created and published by other players.
- **Level editor:** build, test and verify a level before publishing it to the subreddit.
- **Character editor:** choose body colors, eye styles and Memphis patterns, or roll a random combination.
- **Controls:** arrow keys or A/D on desktop; hold the left or right side on mobile. Press R to restart on desktop.

Levels combine ice, conveyor belts, Climber walls, brittle blocks, directional gates, blink blocks, springs, spikes, falling spikes, lasers, hammers, saws, moving platforms and crushers. Climber walls carry you upwards while you press towards them; release or steer away to fall.

## Reddit posts

Campaign posts show **Play Campaign** and open the campaign level selection. A permanent campaign post can be linked from a subreddit button or sidebar. Challenge and community posts open their level immediately. Editor posts open the level editor; weekly replay posts open the released top-five race.

Subreddit moderators can create entry posts using these menu actions:

- **Create campaign post**
- **Create current Weekly Challenge**
- **Create editor post**

Installing the app creates a campaign post and the current Weekly Challenge. 

Players can explicitly create personal challenge posts from eligible verified results. After a challenge closes, posting a result is optional and offered in-game on a subsequent visit; the app does not send unsolicited result notifications.

## Fair competition

The server verifies replays by simulating the submitted inputs with the same game simulation used by the client. Browser-reported times and death counts are not trusted.

Scores belong to the Reddit identity supplied by Devvit through `context.userId` and `context.username`. The client does not supply a player identity. Other players' results, best-run routes and ghosts remain hidden until the challenge closes. Afterwards, the leaderboard releases the top five verified runs, including their character appearances and replays.

## Community moderation

Subreddit moderators with **Posts** or **All** permissions can open **Moderate levels** from the main menu. Moderation applies to community levels in their own subreddit, and permissions are checked server-side. **Hide** removes a level from the catalogue and disables playing it; **Approve / restore** makes it available again and clears its reports. To permanently delete a level, hide it first, select **Delete permanently…**, type the exact level title and confirm with **Permanently delete**. This cannot be undone: the level data, leaderboard, stored replays and community statistics are deleted from the app. The Reddit post and its comments remain unchanged and must be moderated separately using Reddit's controls.

Players can report community levels from the community list. Each authenticated Reddit user can report a level once. At 10 distinct reports, the level is automatically hidden from the catalogue and disabled for play pending moderator review. **Approve / restore** makes the level available again and clears its report counter.

## Data and privacy

**Daily account cleanup:** a scheduled privacy sweep starts every day at **03:00 UTC**, checks registered Reddit accounts and processes the workload in resumable batches. Existing accessible app posts and the community catalogue are scanned to discover older records. Confirmed deleted accounts have their scores, leaderboard entries, player statistics, reports, drafts and stored comment references removed, together with their user ID and author attribution in app-managed post data. Published levels and Reddit posts/comments are retained without app-side identifying attribution; the cleanup does not delete Reddit content. Network, permission and rate-limit errors defer the check without authorizing a deletion, and interrupted cleanup is retried. Because Devvit can also return “not found” for suspended accounts, an inconclusive lookup is checked again daily: accounts that remain unresolvable for 30 days are cleaned up as a retention fallback, which can also affect suspended accounts. A successful lookup cancels that fallback. A recovery job runs every 15 minutes for unfinished batches. Older private data that was never indexed and cannot be discovered through an accessible post remains subject to its existing expiry; Devvit Redis does not provide a global key scan.

Account-associated scores, community statistics, drafts, challenge state and moderation reports are stored server-side in Devvit Redis. A best-run record includes its verified replay and character appearance.

Post score records and leaderboards expire after 90 days. The user score index expires 90 days after the user's last improved verified score.

Campaign progress, character preferences, audio settings and the player's own best-run replay also use device-local browser storage. These local values do not provide account synchronization or establish identity for verified scores.

**Delete saved data** in the main menu calls `DELETE /api/my-data` to remove the authenticated user's stored app data and clears the relevant local preferences and replays. Creator-owned community levels are removed from the app catalogue. Published Reddit posts and comments remain on Reddit and can be managed using Reddit's own controls.
