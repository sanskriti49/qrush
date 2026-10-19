# QRush

**Create limited openings, share one registration link, and give everyone a clear turn.**

QRush now has a complete first product flow: create an opening with its name, description, capacity and opening time; share its public registration page; join and confirm a spot; return through **My registrations** to resume or cancel. The default page is the openings noticeboard. The engineering playground remains available separately.

When a registration window, product release, or workshop opens, demand can arrive much faster than the downstream service can safely process it. QRush places participants in a FIFO queue, admits them within a configurable concurrency budget, and grants short reservations that return to inventory when they expire. Participants can see their position, reservation deadline, and actual inventory instead of an unexplained spinner.

The same engine powers user-created openings and three playground examples: a hackathon with 100 slots, a product release with 80 items, and a workshop with 60 places. Its useful boundary is a burst of demand competing for scarce resources or a constrained downstream service.

## Run locally

Requirements: Docker Compose, Java 21 or newer, and Node.js with npm. Maven is supplied by the wrapper. The existing backend uses Spring Boot 4.1.1 and compiles for Java 21; the frontend uses React 18, TypeScript, Vite, Tailwind, Recharts, and GSAP.

From the repository root:

```powershell
docker compose up -d
docker compose ps
```

In a backend terminal:

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

In a frontend terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open [the workspace](http://127.0.0.1:3000). Vite proxies `/api` to `127.0.0.1:8080`. [Backend health](http://127.0.0.1:8080/api/health) checks both Redis and PostgreSQL and returns HTTP 503 when either is unavailable.

Docker PostgreSQL uses **5433** on the host, leaving a native installation on 5432 alone. Redis uses 6379. Both bind to loopback. Existing named volumes are preserved by `docker compose up -d`; do not use `down -v` if you need the data.

Public development defaults are in `.env.example`. Docker Compose reads an optional root `.env`; Spring reads environment variables from its process. Set `$env:DATABASE_URL` and `$env:DATABASE_PASSWORD` in the terminal that starts Maven when using another database. Changing a Compose password does not change the password inside an initialized PostgreSQL volume. A custom `DATABASE_PORT` requires a matching `DATABASE_URL` for Spring.

Flyway creates the allocation ledger and unique constraints, then Hibernate validates it. Schema conflicts fail startup instead of silently resetting data. Redis AOF persistence is enabled in Compose.

## Create, share and register

1. Open [the noticeboard](http://127.0.0.1:3000/#openings) and choose **Create an opening**.
2. Enter a name, helpful description and 1–1,000 spots. Open immediately or choose a date and time in your browser's time zone. The server stores the opening moment in UTC and rejects early joins.
3. Create the opening and copy its public link. This link contains only the opening ID, never participant credentials. In the local setup it is a localhost link; external access requires hosting.
4. Open the link directly, enter a name and join. During a rush, a live queue shows your place. Admission saves one available spot for five minutes; confirm before the timer ends.
5. Open **My registrations** to resume a queue or reservation, view confirmed places, or cancel with confirmation. Cancellation retains history and returns the spot for another participant. Refreshing recovers the same session and booking rather than creating another one.

Opening details and booking/cancellation history are durable in PostgreSQL. Redis holds the queue, short reservations and browser-session credentials. Registrations belong to the **same browser**, not an account; browser credentials currently expire after seven days, and clearing browser storage prevents access to those saved journeys. The UI identifies unavailable browser passes instead of assuming a booking exists. There is no cross-device account recovery yet.

The form sends a stable creation request ID so retrying a response lost in transit does not create a second opening. Cancellation targets the exact allocation ID, is owner-checked and idempotent, and shares settlement's database lock. Old cancellation/confirmation retries cannot release or restore a replacement booking. Partial unique indexes enforce one active booking per spot and participant while retaining cancelled history.

## Try the queue playground

1. Keep **Live queue** selected and choose a queue in Overview. The name, resource catalog, policy, inventory, and activity come from the server.
2. Click **Try the queue** or open **Join the queue**, enter a display name, and join. The backend issues an opaque session, streams queue changes over SSE, and grants a short admission window. The UI reserves an available resource after admission.
3. Confirm before the reservation expires. A success means the allocation transaction committed to PostgreSQL. Refresh to recover the same reservation or durable receipt using the browser's saved session.
4. Open the Playground and click **Send test crowd**. These are real server-side tasks exercising the same services and Redis scripts. Watch queue length, admission, reservations, confirmations, and recycling change across tabs.
5. Inject the one-second downstream delay or a flow outage. An outage pauses new admission and confirmation while existing deadlines continue. Restore the flow and observe adaptive admission increase gradually.
6. Change admission rate, concurrency, or reservation duration. Existing leases retain their deadline; the new duration applies to subsequent reservations.

**Practice mode** is an explicit alternative for exploring the UI without services. It uses a separate local model and is labeled throughout. A live connection failure shows an error and last-known state; it never turns a failed backend confirmation into simulated success. Live chart history can be cleared without deleting server allocations.

The downloaded confirmation contains the durable allocation reference and an **unsigned QR representation**. It is not a paid ticket or a cryptographically verified credential.

The interface uses top navigation, a queue board, high-contrast cobalt/ink/yellow colors, 16px body copy, and larger controls. The spot map filters available, reserved, confirmed, and owned spots without changing inventory. The buyer journey places the active task first on narrow screens. Dialogs are centered in the viewport, scroll internally on short screens, lock background scrolling, close with Escape or a backdrop click, and restore focus. GSAP animates page entry, changing counts, queue movement, spot changes, activity rows, and confirmation feedback. Reduced-motion preferences are respected. Public activity and errors pass through a copy layer instead of exposing internal logs. Keyboard focus and the skip link are preserved.

## Backend design

- **Queue:** Redis sorted sets use a monotonic arrival sequence. Duplicate joins preserve position. Atomic admission respects the rate, active concurrency cap, and remaining stock. SSE reconnects by reading current queue state; stock snapshots refresh separately.
- **Sessions:** Server-issued credentials are scoped to a flow. Admission tokens are checked for ownership and expiry. A participant can hold only one unit in that flow.
- **Reservation:** Lua atomically checks the catalog, confirmation state, admission, and ownership. Expired reservations are recycled by the scheduler. Release and leave revoke the participant's hold and admission together. Invalid admission is rejected before a ledger lookup.
- **Settlement:** A PostgreSQL transaction, unique indexes on active `(pool_id, unit_id)` and `(pool_id, claimant_id)` bookings, and a per-flow advisory lock protect the ledger. Confirmation retries return the active allocation. Redis is updated after database commit and re-read under the lock to prevent stale confirmations from restoring cancelled bookings.
- **Opening lifecycle:** Durable name, description, capacity and UTC opening time are projected to the fast registry at startup. Both queue joins and holds enforce the opening time on the server. Public pages read lightweight availability counts rather than the full operator inventory.
- **Registration management:** Credential-scoped lookup checks up to 50 saved browser journeys in one request. Cancellation history survives refresh and restarts; reconciliation projects cancelled and active bookings consistently without freeing a replacement booking.
- **Interrupted settlement:** A persistent Redis fence prevents reuse during confirmation. A recovery task checks the ledger under the same database lock, then completes the Redis projection or rolls back an uncommitted reservation. Recovery becomes eligible after 30 seconds.
- **Read recovery:** Startup rehydrates the ledger. Runtime durable reconciliation uses a shared per-flow five-second gate, so each waiting client's snapshot does not trigger its own SQL query.
- **Adaptive control:** Admission reduces when observed confirmation latency or injected delay crosses the controller threshold. An outage sets admission to zero. Recovery raises the adaptive rate gradually toward the configured target. This is a small demonstrator controller, not a tuned production congestion algorithm.
- **Telemetry:** Events and counters are server observations. Latency means confirmation processing latency, including injected delay; it is not a Redis lock p95. Frontend chart rates derive from sampled counters.

## API

All paths below start with `/api`. Default flow IDs are `hackathon`, `product`, and `workshop`.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Real Redis and PostgreSQL health |
| `POST /openings` | Create `{ name, description, capacity, opensAt, requestId? }`; returns public registration path |
| `GET /openings` | Published openings and lightweight live availability |
| `GET /openings/{id}` | Public details, opening time and counts |
| `POST /openings/{id}/reserve` | Save an available spot for an admitted participant |
| `POST /registrations/lookup` | Recover saved journeys from `{ sessions: [{ flowId, claimantId, sessionToken }] }` |
| `GET /flows` | Configured catalogs and policies |
| `GET /flows/{id}` | Inventory, metrics, policy, activity, and load snapshot |
| `POST /flows/{id}/sessions` | Issue `claimantId` and `sessionToken` |
| `POST /waiting-room/{id}/join` | Idempotently join with `userId` and `sessionToken` |
| `GET /waiting-room/{id}/status` | Recover queue/admission/hold state |
| `GET /waiting-room/{id}/stream` | SSE `QUEUE_UPDATE` events |
| `POST /waiting-room/{id}/leave` | Leave and release the owned reservation |
| `GET /pools/{id}/units` | Resource states and reservation TTLs |
| `POST /pools/{id}/hold` | Reserve using `{ unitId, claimantId, admissionToken }` |
| `POST /pools/{id}/release` | Release an owned reservation |
| `POST /pools/{id}/confirm` | Durably confirm; retries return the same allocation ID |
| `GET /pools/{id}/allocation` | Recover committed allocation; 204 when absent |
| `POST /pools/{id}/cancel` | Cancel owned `{ claimantId, allocationId }`; retain history and return inventory |
| `POST /pools/{id}/init` | Initialize a catalog via `prefix` and `totalUnits`; never reset a live pool |
| `PUT /flows/{id}/policy` | Set `{ maxConcurrent, admissionRate, holdSeconds, adaptive }` |
| `POST /flows/{id}/scenario` | Set `mode` to `NORMAL`, `SLOW`, or `OUTAGE` |
| `POST /flows/{id}/load` | Start `{ buyers: 100 }` backend buyers |
| `POST /flows/{id}/load/stop` | Stop generated buyers; preserve human reservations |

Participant operations require their `sessionToken` query parameter. Queue operations use `userId`; allocation operations use `claimantId`. Optional credentials on inventory/snapshot reads mark only the caller's hold. Public resource responses do not expose another participant's identity. Never share URLs containing session credentials.

Policy bounds: concurrency and admission rate 1–100; reservation duration 5–900 seconds. Catalogs hold 1–1,000 resources and generated runs accept 1–1,000 buyers. Queues have a 10,000-entry demonstrator safety limit. Fully confirmed inventory produces an explicit `SOLD_OUT` state.

## Verification

Validated locally: 34 backend tests (33 HTTP integration cases plus startup), 27 frontend checks (26 browser workflows and one copy-safety check), and the frontend production build. The real browser journey verifies SSE, reservation recovery, durable confirmation, and receipt recovery after refresh. Interface checks cover readable labels, no page overflow at 390/768/1024/1440px, and spot filtering through reservation expiry. These are correctness checks; they do not establish a throughput benchmark.

Start Docker services first; backend tests use real Redis and PostgreSQL:

```powershell
cd backend
.\mvnw.cmd test
```

HTTP integration cases cover contested units, duplicate joins, session isolation, admission bypass, one hold per participant, expiry, safe catalog initialization, idempotent confirmation, interrupted settlement recovery, SSE reconnects, adaptive/fixed admission, generated buyers, durable openings, creation retries, scheduled access, owned cancellation, rebooking, and cancellation/confirmation races. Each case creates an isolated catalog or opening and removes only its own fixture data.

Frontend checks:

```powershell
cd frontend
npm run build
npm run test:e2e
```

Browser checks use installed Chrome, exercise the local simulation, and verify live API contracts with controlled responses. To additionally exercise the real running backend through Vite:

```powershell
$env:QRUSH_LIVE_E2E = '1'
npm run test:e2e -- tests/backend-live.spec.ts tests/openings.spec.ts
```

The opt-in checks commit one allocation in an available playground flow and create isolated openings for a real create/share/resume/confirm/cancel/reassign journey and a scheduled countdown. They leave those local browser-test openings available for inspection; the second participant's test booking is cancelled at the end. Regular tests do not consume live demo inventory.

For an external HTTP load run, install [Grafana k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) and run from the repository root:

```powershell
k6 run -e BASE_URL=http://127.0.0.1:8080 -e BUYERS=40 -e CAPACITY=20 load-tests/reservation-rush.js
```

The script creates an isolated `bench-` catalog, joins actual HTTP sessions, reserves and confirms through the queue, retries confirmations, and checks inventory invariants. It retains that benchmark catalog for inspection. Server-side generated buyers demonstrate behavior but are not independent HTTP benchmark clients. No 5,000-requests/second performance claim is established by the code or correctness suite.

## Deployment boundary

This is a **local development demonstrator**. Operator mutations require the enabled loopback environment; disable them with `QRUSH_OPERATOR_ENABLED=false` when appropriate. This guard is not production administrator authentication. Anonymous sessions identify journeys, not unique people, and do not provide bot resistance or account recovery across devices.

Redis scripts target one Redis instance, not Redis Cluster. Queue and leases depend on Redis persistence; complete Redis data loss is outside the current recovery guarantee. PostgreSQL allocations remain durable, but that alone does not restore lost sessions or queue order. Per-flow database locks deliberately serialize settlement for correctness. Horizontal operation, service failover, production authentication, payment, signed credentials, and large-load capacity remain separate work to validate.
