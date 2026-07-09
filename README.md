# Sea Battle Extended

A mobile-first React/TypeScript web implementation of a classic Sea Battle MVP.

## Run

```bash
npm install
npm run dev
```

For local Node WebRTC room signaling in another terminal:

```bash
npm run signal
```

Then open the Vite URL, normally `http://localhost:5173`.

## Cloudflare Worker Signaling

The production signaling service lives in `worker/signaling.ts` and uses one Durable Object per room. This is the piece GitHub Pages cannot run by itself.

Your Worker URL is:

```text
https://seabattle-extended.yohabbodude.workers.dev
```

Opening that URL in a normal browser page is only a health check. The game connects to the same endpoint as a WebSocket:

```text
wss://seabattle-extended.yohabbodude.workers.dev/?room=ABC123&role=host
```

Install and log in:

```bash
npm install
npx wrangler login
```

If Wrangler cannot open a browser login from the current terminal, create a Cloudflare API token and expose it before deploying:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
```

The token needs permission to edit Workers Scripts and Durable Objects on the account that owns `yohabbodude.workers.dev`.

Test the Worker locally:

```bash
npm run worker:dev
```

In another terminal, point the frontend at that local Worker:

```bash
VITE_SIGNALING_URL=ws://localhost:8787 npm run dev
```

Deploy the Worker:

```bash
npm run worker:deploy
```

Wrangler will print a URL like:

```text
https://sea-battle-signaling.YOUR_SUBDOMAIN.workers.dev
```

Use the WebSocket version in `.env.local`:

```bash
VITE_SIGNALING_URL=wss://sea-battle-signaling.YOUR_SUBDOMAIN.workers.dev
```

For this project, use:

```bash
VITE_SIGNALING_URL=wss://seabattle-extended.yohabbodude.workers.dev
```

Then build the frontend:

```bash
npm run build
```

### GitHub Actions Worker Deploy

This repo includes `.github/workflows/worker.yml`. To let GitHub deploy the Worker on commit:

1. In GitHub, open repo Settings -> Secrets and variables -> Actions.
2. Add `CLOUDFLARE_API_TOKEN`.
3. Add `CLOUDFLARE_ACCOUNT_ID`.
4. Push changes to `main`, or run the workflow manually.

The frontend build workflow also bakes in:

```text
VITE_SIGNALING_URL=wss://seabattle-extended.yohabbodude.workers.dev
```

## GitHub Pages

The Vite app is configured with `base: "/SeaBattleExtended/"`, so the static build works from a repository Pages URL such as:

```text
https://YOUR_USERNAME.github.io/SeaBattleExtended/
```

Build with:

```bash
npm run build
```

Publish the generated `dist` folder with your preferred GitHub Pages workflow.

Important: GitHub Pages cannot run WebSocket signaling. The game UI and local practice mode work as static Pages content, but online P2P rooms need the Cloudflare Worker `wss://` signaling endpoint. Set it at build time:

```bash
VITE_SIGNALING_URL=wss://your-signaling-host.example npm run build
```

## Admin Access

Admin actions are protected by the Cloudflare Worker secret named `ADMIN_TOKEN`. Do not put the token in GitHub Pages secrets, Vite env variables, or source files. Add or rotate it in Cloudflare Worker settings as a secret, then deploy the Worker.

The D1 leaderboard database is bound in `wrangler.toml` as:

```toml
[[d1_databases]]
binding = "DB_Leaderboard"
database_name = "seabattleextended_leaderboard"
database_id = "91f0e247-d4be-4cd8-baea-b06033aaf9fd"
```

To use admin controls:

1. Open the site and go to `Profile`.
2. Paste your current `ADMIN_TOKEN` into `Developer admin`.
3. Click `Verify`.

The admin panel can view online/game counts, close a room from the lobby registry/signaling room, clear open lobby listings, and reset the global D1 leaderboard. Closing a room can disconnect players that are still using Worker signaling; an already-established WebRTC data channel is direct browser-to-browser, so true mid-match kicking would require relaying gameplay through Cloudflare instead of P2P.

## Implemented

- Configurable board presets with scaled fleets: 8x8, 9x9, 10x10, 12x12, 14x14, 16x16, and Large Battle 20x20.
- Rule engine with horizontal/vertical ships, no overlap, and a one-cell buffer including diagonals.
- Classic combat: miss ends turn, hit/sunk keeps turn, all ships sunk wins.
- Touch/mouse ship placement, rotate, hover preview, and repeatable shuffle.
- Local practice battle against a generated opponent fleet.
- Blitz mode options with 5/10/15/30 second timers and configurable timeout behavior.
- Local player profile, persistent player ID, avatar token, stats, opponent history, match history.
- Profile export/import through JSON.
- WebRTC data-channel client, local Node signaling server, and Cloudflare Worker Durable Object signaling for hosted room codes.
- Asset manager and audio manager with stable public drop-in paths.
- Responsive mobile-first UI using CSS, no frame-locked animation loop.

## Game Modifiers

Modifiers are optional pre-game rules selected from the setup panel before practice or P2P play.

- `Fog Tide`: adds a very low-opacity animated fog layer over the target board. It follows the current wind indicator shown in the board header. It is visual pressure only; your selected square is still the square you fire at.
- `Storm Mode`: every 18 total moves, `storm_warn.mp3` plays once 10 seconds before a storm wave hits. At impact, `storm_wave.mp3` plays and the storm may nudge one fully unhit ship by one square if normal placement rules still allow it. In P2P, moved boards are synced after the wave.
- `Treasure Tiles`: hidden treasure can appear on water tiles. Hitting real treasure grants a one-hit shield. The shield blocks the next shot that would successfully hit one of your ships, consumes the shield, and lets that same square be fired at again later.
- `Multi-bomb Treasure`: rare treasure with a 3.33% board-spawn chance, about 1 in 30 generated boards. When found, it arms one attack where you select 3 legal target squares anywhere on the target board before pressing Fire. They do not need to be connected or in a row. Disabled squares, already resolved shots, and blocked sunk-ship buffer squares cannot be selected. The hit/miss results are not revealed until Fire is clicked.
- `Heat-seeking Missile Treasure`: super rare treasure with a 1% board-spawn chance, about 1 in 100 generated boards. When found, it attempts to hit one random un-sunk enemy ship. Larger ships are weighted much higher than smaller ships; if only small ships remain, the missile can still hit but has a fair miss chance.
- `Pirate Chaos`: adds rare cursed cannonballs and fake treasure. Cursed cannonballs have a 6% chance on eligible shots, about 1 in 17 shots, to curve to a valid neighboring square without preview; after firing, a toast says `Curveball!`. Fake treasure reveals itself after firing and grants no reward.

### Modifier Odds

- Treasure shield tiles: 1 hidden shield tile on 8x8 through 20x20 boards while Treasure Tiles is enabled.
- Multi-bomb treasure: 3.33% chance per generated board, about 1 in 30.
- Heat-seeking missile treasure: 1% chance per generated board, about 1 in 100.
- Fake treasure: 1 hidden fake tile on 8x8 through 20x20 boards while Pirate Chaos is enabled.
- Curveball: 6% chance per eligible Pirate Chaos shot, about 1 in 17.
- Storm wave: every 18 total moves while Storm Mode is enabled.

## Asset Paths

Drop your files into:

- `public/assets/audio`
- `public/assets/textures`
- `public/assets/sprites`

The manifest is in `src/services/assets.ts`. Replace or extend keys there to map game events to your files.

Reaction audio keys currently use `react_laugh.mp3`, `react_confused.mp3`, `react_think.mp3`, and a drop-in `public/assets/audio/react_angry.mp3` path until an imported source asset is added for angry.

## Architecture

- `src/game` contains board config, placement rules, combat engine, and animation timing helpers.
- `src/services` contains storage, assets, audio, and WebRTC networking.
- `src/components` contains reusable UI panels and the board renderer.
- `server/signaling.ts` is intentionally minimal and stores no permanent game data.

## Notes

The current gameplay MVP is fully playable locally. The P2P layer establishes rooms and a WebRTC data channel with identity exchange; GitHub Pages deployment requires the Cloudflare Worker signaling URL because Pages is static-only hosting.
