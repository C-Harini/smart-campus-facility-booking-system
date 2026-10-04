# Smart Campus Facility Booking System with an NLP-Based AI Booking Agent

Full-stack **MERN** app (React + Vite + TypeScript, Express, MongoDB/Mongoose, JWT) with a floating
**Campus Booking Assistant** chatbot. Users can book through normal forms *or* just tell the chatbot what
they want; the agent collects missing details one question at a time, checks real availability,
suggests alternative slots, and books through the same secured backend.

## 1. Quick start

Requirements: Node.js 18+ and MongoDB (local, Docker, or MongoDB Atlas).

```bash
# 0. (optional) MongoDB via Docker
docker compose up -d

# 1. Backend
cd backend
npm install
cp .env.example .env        # then edit JWT_SECRET (and MONGO_URI if needed)
npm run seed                # creates demo users + 14 facilities (use `npm run seed -- --fresh` to wipe first)
npm run dev                 # API on http://localhost:5000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                 # app on http://localhost:5173  (proxies /api to :5000)
```

Demo accounts (created by the seed script):

| Role    | Email               | Password     |
|---------|---------------------|--------------|
| Admin   | admin@campus.edu    | Admin@123    |
| Student | student@campus.edu  | Student@123  |

Tests (no database needed): `cd backend && npm test`

## 2. The AI / NLP agent

`POST /api/chat` receives the message, loads the user's `ChatSession` (history + `bookingContext`), runs the
agent, saves the reply, and returns `{ reply, intent, bookingContext, bookingChanged, booking }`.

Two interchangeable engines (same tools, same rules):

1. **LLM agent** (set `ANTHROPIC_API_KEY` in `backend/.env`). Claude is given a set of **tools** and runs a
   tool-use loop: it detects the intent, extracts entities, asks for missing info, and calls tools such as
   `checkAvailability()` / `createBooking()`. Model is configurable with `ANTHROPIC_MODEL`.
2. **Built-in rule-based NLP agent** (default when no key is set, and automatic fallback if the LLM call
   fails). Regex/grammar-based intent detection and entity extraction (dates like *tomorrow / next Monday /
   10 October*, times like *from 2 to 4*, participants, purpose, booking IDs) plus a small state machine.
   Works fully offline, so the whole project is demo-able without any API key.

Supported intents: `BOOK_FACILITY`, `CHECK_AVAILABILITY`, `SHOW_AVAILABLE_SLOTS`, `MY_BOOKINGS`,
`BOOKING_STATUS`, `CANCEL_BOOKING`, `FACILITY_INFORMATION`, `GENERAL_QUERY`.

### Safety rules implemented

* **The AI never touches MongoDB.** It can only call the functions in `backend/src/services/agentTools.js`
  (`searchFacilities`, `getFacilityDetails`, `checkAvailability`, `getAvailableSlots`,
  `findAvailableFacilities`, `createBooking`, `getMyBookings`, `getBookingStatus`, `cancelBooking`,
  `updateBookingContext`). These call the same service layer as the REST API.
* **The user identity comes from the JWT**, never from model-supplied arguments.
* **No false confirmations.** `createBooking` / `cancelBooking` refuse to run unless the user explicitly
  confirmed (`userConfirmed: true`). The reply is generated from the tool result, and `guardReply()` rewrites
  any LLM answer that claims a booking/cancellation (or quotes a booking ID) the backend did not actually return.
  If the DB operation fails, the user is told it could not be completed.

## 3. Booking conflict protection

* Times are stored as plain strings (`YYYY-MM-DD`, `HH:mm`) -> no timezone bugs. "Today"/"past" use `TIMEZONE` (default `Asia/Kolkata`).
* Overlap rule: existing `start < requested end` **and** `existing end > requested start`, for `Pending`/`Confirmed` bookings. Back-to-back bookings (e.g. 2-3 PM and 3-4 PM) are allowed.
* The service re-checks availability **immediately before inserting**.
* On top of that, every booking stores one key per 30-minute block (`slotKeys`) covered by a **unique sparse index**, so even two simultaneous requests cannot both succeed - MongoDB rejects the second one (duplicate key) and the API returns `409` with the free ranges. Cancelling/rejecting `$unset`s the keys, releasing the slot.
* Facility rules enforced server-side: active status, operating days, opening/closing hours, min/max duration, capacity, 30-minute alignment, no past bookings.

## 4. REST API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | public registration always creates a `student` |
| GET | `/api/auth/me` | current user |
| GET | `/api/facilities` | `?q=&type=&minCapacity=` (admin also `?status=`) |
| GET | `/api/facilities/:id` | |
| GET | `/api/facilities/:id/availability?date=YYYY-MM-DD` | slots + free ranges |
| POST / PUT / DELETE | `/api/facilities[/:id]` | admin; DELETE = deactivate |
| POST | `/api/bookings` | `{facilityId,date,startTime,endTime,purpose,participants}` |
| GET | `/api/bookings/my?scope=upcoming\|history\|all` | |
| GET | `/api/bookings/:id` | `_id` or `FAC1024`; owner or admin |
| PUT | `/api/bookings/:id/cancel` | owner or admin |
| GET | `/api/bookings` | admin; `?status=&date=&facilityId=` |
| PUT | `/api/bookings/:id/status` | admin; `{status:"Confirmed"\|"Rejected"}` for pending |
| GET/PUT/DELETE | `/api/users[/:id]` | admin |
| GET | `/api/admin/stats`, `/api/admin/reports` | admin |
| POST | `/api/chat` | `{message}`; also `GET /api/chat/history`, `POST /api/chat/reset` |

Booking IDs are sequential: `FAC1024`, `FAC1025`, ... Statuses: Pending, Confirmed, Rejected, Cancelled, Completed
(confirmed bookings become Completed automatically after their end time). Facilities with
"requires approval" create `Pending` bookings that an admin approves/rejects.

## 5. Project layout

```
backend/
  src/
    models/        User, Facility, Booking, ChatSession, Counter
    routes/        auth, facilities, bookings, users, admin, chat
    services/      bookingService (rules + conflict logic), agentTools, llmAgent, fallbackAgent
    nlp/parser.js  dates / times / participants / purpose extraction
    middleware/    JWT auth, error handling
    seed.js        demo data
  tests/           parser, booking rules, agent conversations (DB stubbed)
frontend/
  src/
    pages/         Login, Register, Dashboard, Facilities, BookFacility, MyBookings, CheckAvailability, admin/*
    components/    Navbar, ChatWidget (floating), SlotGrid, FacilityCard, StatusBadge
```

## 6. Production notes

* Set a long random `JWT_SECRET`, restrict `CLIENT_ORIGIN`, serve over HTTPS.
* `npm run build` in `frontend/` creates `dist/`; host it statically and set `VITE_API_URL` to your API's `/api` URL.
* Passwords are hashed with bcrypt via the `bcryptjs` package (pure JS, no native build step).
