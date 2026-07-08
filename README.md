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

- `Fog Tide`: adds a lightweight animated fog layer over the target board. It is visual pressure only; your selected square is still the square you fire at.
- `Storm Mode`: every few moves, `storm_warn.mp3` plays 10 seconds before a storm wave hits. At impact, `storm_wave.mp3` plays and the storm may nudge one fully unhit ship by one square if normal placement rules still allow it. In P2P, moved boards are synced after the wave.
- `Treasure Tiles`: hidden treasure can appear on water tiles. Hitting real treasure grants a one-hit shield. The shield blocks the next shot that would successfully hit one of your ships, consumes the shield, and lets that same square be fired at again later.
- `Pirate Chaos`: adds rum fog, fake treasure, and cursed cannonballs. Rum fog and curved cannonballs can randomly shift a fired shot to a valid neighboring square without preview; after firing, a toast tells you what happened. Fake treasure reveals itself after firing and grants no reward.

## Asset Paths

Drop your files into:

- `public/assets/audio`
- `public/assets/textures`
- `public/assets/sprites`

The manifest is in `src/services/assets.ts`. Replace or extend keys there to map game events to your files.

## Architecture

- `src/game` contains board config, placement rules, combat engine, and animation timing helpers.
- `src/services` contains storage, assets, audio, and WebRTC networking.
- `src/components` contains reusable UI panels and the board renderer.
- `server/signaling.ts` is intentionally minimal and stores no permanent game data.

## Notes

The current gameplay MVP is fully playable locally. The P2P layer establishes rooms and a WebRTC data channel with identity exchange; GitHub Pages deployment requires the Cloudflare Worker signaling URL because Pages is static-only hosting.
