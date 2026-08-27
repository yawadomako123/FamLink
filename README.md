# FamLink

A private family coordination and safety app.

> Know where your family is, know they're safe, and stay connected.

A family creates a private FamLink space and invites its members. Everyone chooses,
for themselves and per family, whether to share their location. **FamLink never
tracks anyone silently** — sharing is off until you switch it on, and one control
switches it back off.

---

## Status

All eight phases are complete. What each one delivered:

| Phase | Scope | Status |
| ----- | ------------------------------------------------ | ------ |
| 1 | Foundation: auth, database, app shell, PWA | ✅ Done |
| 2 | Families, invitations, roles, member management | ✅ Done |
| 3 | Location sharing, permission model, location API | ✅ Done |
| 4 | Live family map | ✅ Done |
| 5 | Places and geofencing | ✅ Done |
| 6 | Notifications, arrival alerts, SOS | ✅ Done |
| 7 | Family chat | ✅ Done |
| 8 | Polish, accessibility, performance, security review | ✅ Done |

---

## Features

- **Authentication** — email/password sign-up, login, password reset, persistent sessions.
- **Families** — create a family, invite by link, roles (`owner` / `admin` / `member`).
- **Live location** — opt-in sharing with explicit on / paused / off states, throttled updates, and an always-visible stop control.
- **Family map** — everyone on one map, with honest *Live* versus *Last seen* labelling.
- **Places** — name the locations that matter (Home, School, Work) with a geofence radius.
- **Alerts** — arrival and departure events, plus an SOS that reaches the whole family at once.
- **Chat** — one realtime thread per family, with unread counts and reactions.
- **Voice and video calls** — peer-to-peer WebRTC, up to four people; media never touches the server.
- **Check-ins** — ask a family member if they're OK, answered in one tap.
- **Several families** — belong to more than one, with separate sharing settings and alerts for each.
- **Installable PWA** — works on mobile, tablet and desktop; installs to the home screen.

---

## Tech stack

| Layer | Choice | Why |
| ------------- | -------------------------------- | ----------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19 | Server components plus a single deployable for web and API |
| Language | TypeScript (strict) | |
| Styling | Tailwind CSS v4 | Design tokens declared in `app/globals.css` |
| Database | Neon Postgres + Drizzle ORM | Serverless Postgres, typed schema, SQL migrations in the repo |
| Auth | Better Auth | Handles hashing and sessions; has bearer-token and Expo support |
| Realtime | SSE over Postgres `LISTEN/NOTIFY` | No third-party message broker |
| Maps | MapLibre GL 5 | Open source, no proprietary tile lock-in |
| File storage | Vercel Blob | Avatar uploads |
| Validation | Zod | Shared between forms and API routes |
| Tests | Vitest | |

---

## Architecture

```
Browser (PWA)                     Future React Native / Expo app
     │                                        │
     │  session cookie                        │  Authorization: Bearer <token>
     └────────────────┬───────────────────────┘
                      ▼
            Next.js  /api/v1/*
       (authorization, validation, rate limits)
                      │
                      ▼
              Neon Postgres
        ┌─────────────┴─────────────┐
        │                           │
   pooled queries          direct connection
   (application)          (LISTEN/NOTIFY → SSE)
```

Three decisions worth knowing before reading the code:

**1. Domain logic lives in REST route handlers, not server actions.**
Server actions are reachable only from a React client. Putting family, location,
chat and SOS behaviour behind `app/api/v1/*` means a future Expo app talks to
exactly the same endpoints with a bearer token instead of a cookie — no parallel
API to maintain.

**2. Authorization is enforced server-side, on every request.**
The browser never holds a database credential; all access is mediated by route
handlers. Each one independently re-derives `authenticated user → family
membership → required role` from the database. Nothing from the client — family
id, member id, role — is trusted.

**3. One rule decides location visibility.**
`lib/permissions/location-visibility.ts` holds it, deliberately free of database,
environment and framework dependencies so it stays directly unit-testable. Every
surface (map, member list, realtime stream, history) defers to it:

> A viewer may see a target's location only if the viewer is in the family, the
> target is in the same family, the target's sharing state is `sharing`, and the
> target's visibility admits that viewer. You can always see your own.

`paused` withholds location exactly like `off` — that's the promise the pause
control makes to the person who tapped it.

**4. Realtime events carry invalidation hints, never data.**
`NOTIFY` is a broadcast: every listener receives every message. If a location
update carried coordinates, they would reach a process that must then be
trusted to filter per-viewer, and one bug there leaks a position somebody
explicitly hid. Instead an event says only *that* something changed in a
family, and the client re-fetches through the ordinary authorized endpoint — so
the visibility rule is applied on every read, by the same code path as a page
load. Realtime cannot become a second, weaker authorization surface.

### Project structure

```
app/
  (auth)/            login, register, forgot/reset password
  (app)/             authenticated routes — dashboard, map, family, chat, …
  api/auth/[...all]  Better Auth handler
  api/v1/            FamLink REST API
components/
  ui/                primitives — button, input, card, avatar, feedback states
  layout/            app shell, sidebar, bottom nav, top bar
lib/
  auth/              Better Auth server config, client, session helpers
  db/                Drizzle schema and connection pool
  permissions/       authorization — the security core
  api/               route wrappers, error taxonomy, rate limiting
  validation/        Zod schemas shared by forms and API
drizzle/             generated SQL migrations
scripts/             migrate, seed, icon generation
tests/               unit and authorization tests
```

---

## Environment variables

Copy `.env.example` to `.env.local` and fill it in. Only `NEXT_PUBLIC_*` variables
reach the browser; everything else is server-only and must never be prefixed.

| Variable | Required | Purpose |
| ----------------------------- | -------- | ---------------------------------------------------- |
| `DATABASE_URL` | Yes | Pooled connection for application queries |
| `DATABASE_URL_UNPOOLED` | Yes | Direct connection for migrations and `LISTEN/NOTIFY` |
| `BETTER_AUTH_SECRET` | Yes | Session signing key, ≥32 chars |
| `BETTER_AUTH_URL` | Yes | Public origin of the app |
| `NEXT_PUBLIC_APP_URL` | Yes | Used to build invitation links |
| `NEXT_PUBLIC_MAP_STYLE_URL` | No | MapLibre style; falls back to a free OSM raster style |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob; without it avatar uploads are disabled |
| `TURN_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` | No | WebRTC relay; without it ~15–20% of calls cannot connect |
| `RESEND_API_KEY` | No | Password reset email; without it, dev logs to console |
| `EMAIL_FROM` | No | Sender address for transactional mail |

> **`DATABASE_URL_UNPOOLED` must not be the pooled URL.** PgBouncer runs in
> transaction mode and silently breaks `LISTEN/NOTIFY`, which the realtime
> stream depends on. On Neon it is the connection string *without* `-pooler`
> in the hostname.

Generate a secret with:

```bash
openssl rand -base64 32
```

---

## Local setup

Requires Node 20+ and Docker (for the local database).

```bash
npm install
```

```bash
cp .env.example .env.local
```

Then set `BETTER_AUTH_SECRET` in `.env.local`, start Postgres and apply the schema:

```bash
npm run db:up && npm run db:migrate && npm run dev
```

The app runs at http://localhost:3000.

The local container is plain Postgres 16. Neon is standard Postgres, so the same
migrations apply unchanged — point `DATABASE_URL` and `DATABASE_URL_UNPOOLED` at
your Neon branch when you're ready.

### Database

Migrations are generated from `lib/db/schema.ts` and committed as SQL.

```bash
npm run db:generate
```

```bash
npm run db:migrate
```

Inspect data with `npm run db:studio`.

The location tables are split deliberately:

- `locations` — append-only history, indexed on `(user_id, recorded_at desc)`.
- `current_locations` — exactly one row per member per family. **This is the only
  table the live map reads**, so rendering the map never scans history.

### PWA

The manifest is generated by `app/manifest.ts`; icons are produced by a
dependency-free rasteriser:

```bash
npm run icons
```

The service worker (`public/sw.js`) is registered in production only. It caches
the app shell and static assets and **never caches any `/api/` response** —
those carry family locations, messages and emergency events, where a stale
cached copy would be both a privacy leak and a correctness bug.

---

## Development commands

| Command | Does |
| --------------------- | ------------------------------------------- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run verify` | typecheck + lint + test + build |
| `npm run db:up` / `db:down` | Start/stop local Postgres |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle tooling |
| `npm run db:seed` | Development fixture family (refuses non-local databases) |
| `npm run icons` | Regenerate PWA icons |

---

## Testing

Authorization tests run against a real Postgres database. Create it once:

```bash
docker exec famlink-postgres psql -U famlink -d postgres -c "CREATE DATABASE famlink_test OWNER famlink;"
```

```bash
TEST_DATABASE_URL=postgresql://famlink:famlink_dev_password@localhost:5432/famlink_test npm run db:migrate
```

```bash
npm test
```

The suite refuses to run unless the database name contains `famlink_test`, so
it cannot destroy development data.

Security and authorization tests carry the most weight here — the priority is
proving that data *cannot* be reached, not that buttons render. Covered:
location visibility across every sharing/visibility combination, role ranking,
rate limiting, location freshness (that a stale fix is never labelled live),
geofence transitions (including a jitter simulation that must emit nothing),
notification payloads containing no coordinates, chat and SOS authorization,
and family authorization end to end — cross-family isolation, removed members,
role escalation attempts, invitation expiry and revocation, concurrent
redemption of a single code, and that no invitation row contains a plaintext
code.

---

## Deployment

Target is **Vercel + Neon**.

1. Create a Neon project; copy both the pooled and unpooled connection strings.
2. Import the repository into Vercel.
3. Set the environment variables from the table above.
4. Run `npm run db:migrate` against the Neon branch.

The realtime SSE endpoint needs a long-running function — enable **Fluid Compute**
on Vercel. Without it the stream is cut at the function timeout; the client
reconnects automatically and falls back to polling, so the app degrades rather
than breaks.

---

## Known limitations

These are real constraints, documented rather than papered over.

### Background location

**A PWA cannot do continuous background GPS.** This is a browser platform limit,
not something FamLink can engineer around. Concretely:

- Location updates flow only while FamLink is **open in the foreground**.
- Closing the tab, locking the phone or switching apps stops updates.
- Installing FamLink to the home screen does **not** change this.
- Geofence arrival and departure are therefore evaluated **server-side when a
  location update arrives** — not continuously.

The product is built to be honest about this: the UI distinguishes **Live** from
**Last seen** everywhere, and never renders an old position as a current one.

The backend is designed so a native client can close this gap without any
architectural change. A React Native/Expo app can post the same
`location / battery / device status` payloads to the same endpoints with a
bearer token, and background geofencing improves immediately.

### Other limitations

- **The default map tiles are for development only.** With no
  `NEXT_PUBLIC_MAP_STYLE_URL` set, FamLink falls back to OpenStreetMap's public
  raster tiles so a fresh checkout renders a real map. The OSMF tile usage
  policy does not permit production traffic there — point the variable at
  MapTiler, Protomaps, Stadia or your own tile server before shipping. No code
  change is needed.
- **MapLibre is pinned to 5.x.** Version 6 loads its worker as a separate
  module resolved against `import.meta.url`, which Next does not serve out of
  `node_modules`; the browser gets an HTML 404 and rejects it on MIME type.
  Version 5 inlines the worker.
- **Calls need TURN to be reliable.** WebRTC connects browsers directly, which
  works for most home broadband using the built-in STUN servers. Behind
  symmetric NAT, carrier-grade NAT (common on mobile networks) or a restrictive
  firewall there is no direct path, and roughly 15–20% of calls will fail
  without a TURN relay. FamLink ships STUN-only and says plainly when a call
  failed for this reason rather than spinning on "Connecting". Set `TURN_URL`
  before relying on calls.
- **Calls are capped at four people.** Every participant holds a peer
  connection to every other, so upload cost grows with each one. Beyond four a
  typical phone starts dropping frames. Going further needs an SFU, which is a
  server component outside this scope — so the cap is enforced and explained
  rather than allowed to degrade.
- **Location accuracy has a hardware floor.** Consumer GNSS is roughly 3–10m
  outdoors, 20–50m in built-up areas, and often 100m+ indoors where the fix
  comes from Wi-Fi rather than satellites. FamLink filters implausible jumps,
  prefers more accurate fixes, smooths jitter and samples for a better first
  fix — but it cannot beat the hardware, and the UI describes precision rather
  than implying more than it has.
- **Rate limiting is per-instance.** The in-process limiter in
  `lib/api/rate-limit.ts` is exact on one instance; across several serverless
  instances the effective limit is (limit × instances). Sufficient to stop a
  runaway client; swap `hit()` for a shared store before it needs to be a quota.
- **Battery is optional.** The Battery Status API is unavailable in Safari and
  Firefox. The schema carries `battery_percentage` / `is_charging` /
  `battery_updated_at` for a native client to populate; the UI omits battery
  rather than guessing.
- **Email requires a provider.** Without `RESEND_API_KEY`, password reset emails
  print to the server console in development and throw in production, rather
  than silently vanishing.
- **SOS alerts family members only.** FamLink does **not** contact police,
  ambulance or any emergency service, and never claims to. The UI says so in
  the confirmation dialog, in the sent confirmation, and beside every active
  alert.
- **An active SOS overrides the sender's location visibility.** This is a
  deliberate, narrow exception: raising an SOS is a specific, deliberate
  request for this family's help, which is stronger consent than a standing
  preference. It applies only to the coordinates captured at that moment, only
  while the alert is active, and never to the sender's ongoing position.

---

## Future mobile architecture

```
FamLink PWA ─────┐
                 ├──► Next.js API (/api/v1) ──► Neon Postgres + LISTEN/NOTIFY
React Native ────┘
   (Expo)
```

The API depends on no browser-only behaviour. Better Auth's bearer plugin is
already enabled, so a native client authenticates against the same endpoints
with `Authorization: Bearer <token>` instead of a session cookie.

---

## Not in the MVP

Payments, subscriptions, advertising, AI features, voice/video calls, social
feeds, public profiles, public location sharing, driving-behaviour scoring,
wearables, smart-home integrations, and emergency-service integrations.
