# Digital Split-Flap Display

A realistic airport-style split-flap display that shows your Plex request queue in real time, pulling directly from the plex-discord-bot SQLite database.

## What it looks like

Amber characters on black cards, each character flipping through intermediate values with a mechanical click sound — just like the departure boards at old airports.

Columns: **#** · **TYPE** · **TITLE** · **STATUS** · **REQUESTED BY**

Requests are sorted: In Progress → Pending → Not Out Yet → Unavailable.

---

## Requirements

- Node.js **18 or newer** (18+ has the built-in `fetch` used for Discord username lookups)
- Access to the `plex-requests.db` file that the bot writes to

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/LazyEyeMcfly/digital-split-flap-display.git
cd digital-split-flap-display
npm install
```

### 2. Configure `.env`

Copy the example and fill it in:

```bash
copy .env.example .env      # Windows
cp .env.example .env        # Mac / Linux
```

The only required setting is `DB_PATH` — the full path to the bot's database file.

#### Running the bot on a NAS, display on your Windows PC

Map the NAS share as a network drive (e.g. `Z:`) in Windows Explorer, then:

```
DB_PATH=Z:\plex-bot\db\plex-requests.db
```

#### Everything on the same machine

```
DB_PATH=C:\path\to\plex-discord-bot\db\plex-requests.db
```

#### Optional: real Discord usernames

Add your bot token so requesters show as their actual Discord name instead of `USER1234`:

```
DISCORD_TOKEN=your-bot-token-here
```

### 3. Run

```bash
npm start
```

Then open **http://localhost:3000** in your browser.

Click anywhere on the page first to unlock the flip sound (browsers require a user gesture before playing audio).

---

## How it works

```
Browser (display.js)  ←─── WebSocket ───→  server.js  ←── SQLite (read-only) ──  plex-bot DB
```

- `server.js` opens the bot's SQLite file **read-only** and polls it every `POLL_INTERVAL` ms (default 2 s).
- When the request list changes, it pushes the new rows over WebSocket to all connected browsers.
- The browser animates only the characters that changed — each one cycles through intermediate characters exactly like a physical split-flap board.
- Sound is synthesised via the Web Audio API (no audio files needed).

---

## Configuration reference

| Variable | Default | Description |
|---|---|---|
| `DB_PATH` | *(required)* | Absolute path to `plex-requests.db` |
| `DISCORD_TOKEN` | *(optional)* | Bot token for resolving Discord usernames |
| `PORT` | `3000` | Port the server listens on |
| `POLL_INTERVAL` | `2000` | DB poll interval in milliseconds |
| `MAX_ROWS` | `10` | Maximum rows shown on the board |

---

## Making it visible to others on your network

Anyone on the same network can open `http://YOUR-PC-IP:3000` in a browser.

Find your PC's IP with `ipconfig` (Windows) or `ip addr` (Linux/Mac), then share that address.
