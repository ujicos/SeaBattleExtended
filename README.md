# Sea Battle Extended

Mobile-first React/TypeScript Sea Battle with local practice, WebRTC P2P rooms, Cloudflare Worker signaling, modifiers, treasures, achievements, XP, prestige, stats, admin tools, and GitHub Pages hosting.

## Quick Start

```bash
npm install
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

Production frontend hosting can live on GitHub Pages because the app is static. Online P2P still needs the Cloudflare Worker WebSocket signaling endpoint.

## GitHub Pages

The Vite app is configured for:

```text
/SeaBattleExtended/
```

Build:

```bash
npm run build
```

Publish `dist` through GitHub Pages or your existing GitHub workflow.

Use this build-time signaling URL:

```bash
VITE_SIGNALING_URL=wss://seabattle-extended.yohabbodude.workers.dev npm run build
```

## Cloudflare Worker Signaling

The Worker lives in:

```text
worker/signaling.ts
```

It handles:

- P2P room signaling.
- Lobby listing and presence counts.
- Admin lobby controls.
- D1 global leaderboard API.

Worker URL:

```text
https://seabattle-extended.yohabbodude.workers.dev
```

The browser game connects as WebSocket:

```text
wss://seabattle-extended.yohabbodude.workers.dev/?room=ABC123&role=host
```

Deploy:

```bash
npm run worker:deploy
```

Local Worker test:

```bash
npm run worker:dev
VITE_SIGNALING_URL=ws://localhost:8787 npm run dev
```

## Cloudflare Bindings

D1 leaderboard binding in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB_Leaderboard"
database_name = "seabattleextended_leaderboard"
database_id = "91f0e247-d4be-4cd8-baea-b06033aaf9fd"
```

Worker secret:

```text
ADMIN_TOKEN
```

Do not put `ADMIN_TOKEN` in frontend env files, source code, GitHub Pages, or Vite variables.

## Admin Tools

Open `Profile`, paste the current `ADMIN_TOKEN`, then click `Verify`.

Admin tools can:

- Verify Worker admin access.
- Remember or forget the token locally.
- View Worker online/game/leaderboard counts.
- Close open or full lobbies.
- Clear lobby listings.
- Reset the global leaderboard.
- Use debug match tools such as Tactical Nuke.
- Preview prestige name effects without changing real rank, XP, or prestige.
- Reveal hidden achievements for preview.

Developer identity is sent over P2P while verified as admin, so other players can see a `DEV` badge even if your display name does not include `dev`.

## Gameplay

- Board presets: Classic 8x8, 9x9, 10x10, Extended 12x12, 14x14, 16x16, and Large Battle 20x20.
- Ships are horizontal or vertical only.
- Ships cannot overlap or touch, including diagonals.
- The board starts randomized; you can rotate or shuffle before readying.
- Hits keep your turn.
- Misses pass the turn.
- Sinking all enemy ships wins.
- Sunk ships disable their surrounding buffer area.
- P2P rooms have share codes and share links.
- Host controls match settings; guest can view them.
- Chat and quick reactions are available in P2P matches.

## Modifiers

Modifiers are selected before the game starts.

### Blitz Mode

Adds a turn timer with configurable timeout behavior.

### Fog Tide

Adds a lightweight animated fog layer over the target board. It follows the current wind indicator and is visual pressure only.

### Storm Mode

Every 18 total moves, a warning plays 10 seconds before a storm wave. At impact, the storm may nudge one fully unhit ship by one square if placement rules allow it. P2P boards sync after storm movement.

### Treasure Tiles

Adds hidden treasure on water tiles.

Treasure types:

- `Shield`: arms a one-hit shield. The next successful hit against your fleet is blocked.
- `Multi-bomb`: rare. Select 3 legal target squares anywhere on the board before firing.
- `Heat-seeking Missile`: super rare. Attempts to hit a random unsunk enemy ship, weighted toward larger ships.
- `Repair Kit`: rare. Repairs one damaged unsunk ship segment. It cannot repair 1x1 ships.
- `Splash Zone`: rare. Your next successful normal hit marks nearby water around the impact.

### Pirate Chaos

Adds fakeouts and cursed shots.

Effects:

- `Fake Treasure`: looks like treasure but grants nothing.
- `Decoy`: rare. Shows a quick clown popup with `Decoy!`.
- `Curveball`: cursed cannonball may randomly curve to a neighboring valid square without preview.

## Modifier Odds

Per generated board:

- Shield treasure: 1 tile while Treasure Tiles is enabled.
- Multi-bomb: 3.33%, about 1 in 30.
- Heat-seeking missile: 1%, about 1 in 100.
- Repair Kit: about 4.55%, 1 in 22.
- Splash Zone: 4%, 1 in 25.
- Fake treasure: 1 tile while Pirate Chaos is enabled.
- Decoy: about 2.22%, 1 in 45.

Per eligible Pirate Chaos shot:

- Curveball: 6%, about 1 in 17.

Storm:

- Wave cycle: every 18 total moves.

## XP, Rank, Prestige

- XP is earned from shots, hits, sunk ships, wins, and losses.
- Rank max is 55.
- At max rank, you can prestige from the Stats page.
- Prestige resets rank XP but keeps lifetime XP.
- Prestige adds name effects.
- Prestige effects sync across P2P identities.
- Admins can preview prestige effects without changing real stats.

## Achievements

Achievements include visible and hidden goals across combat, modifiers, treasures, XP progression, and long-term play.

Examples:

- First Blood
- Shipbreaker
- Captain's Mark
- Clock Captain
- Old Salt
- Speed Demon
- Fog Dweller
- Stormborn Captain
- Treasure Hunter
- Chaos Regular
- Untouched Fleet
- Through the Fog
- Storm Chaser
- Buried Booty
- Fool's Gold
- Lucky Charm
- Patch Job
- Splash Zone
- Baited
- Triple Tap
- Full Send
- Close Call
- Tiny Terror
- Silent Sea
- Perfect Storm
- Chaos Crown

Admin-only debug actions do not grant unfair achievements.

## Stats, Import, Export, Leaderboards

Local stats include:

- Games, wins, losses.
- Shots, hits, accuracy.
- Ships sunk.
- XP, lifetime XP, rank, prestige.
- Achievements.
- Opponent records.
- Match history.

Profile export/import is JSON and includes all local stats, achievements, XP, prestige, opponents, and history.

Global leaderboard uses Cloudflare D1. Names containing `dev` are hidden from public leaderboard views and are skipped from new public leaderboard submissions. Admins can view hidden developer rows with a red `DEV` marker.

## Audio

Audio uses bundled assets from `src/assets/audio` and public drop-in paths for optional replacements.

Important files:

- `theme.mp3`
- `bomber_flyby.mp3`
- `whizz_hit.mp3`
- `explode.mp3`
- `water_miss.mp3`
- `victory.mp3`
- `defeat.mp3`
- `storm_warn.mp3`
- `storm_wave.mp3`
- `react_laugh.mp3`
- `react_confused.mp3`
- `react_think.mp3`
- `react_angry.mp3`

The audio manager uses ambient device audio where supported, resumes on user interaction/focus, and lets players mute music only or all sound.

## Asset Paths

Drop-in folders:

```text
public/assets/audio
public/assets/textures
public/assets/sprites
```

Bundled source assets:

```text
src/assets/audio
```

Manifest:

```text
src/services/assets.ts
```

## Architecture

- `src/game`: board config, placement, treasure seeding, combat helpers.
- `src/services`: storage, assets, audio, networking, version.
- `src/components`: board and UI panels.
- `worker/signaling.ts`: Cloudflare Worker and Durable Object signaling.
- `server/signaling.ts`: local Node signaling fallback.

## Notes

GitHub Pages hosts the frontend. Cloudflare Worker handles online rooms, presence, lobby listings, admin routes, and leaderboard API. The live match data channel is P2P after WebRTC connects.
