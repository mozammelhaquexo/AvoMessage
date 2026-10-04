# Voice & Calling — Manual 2-Client Test Procedure

End-to-end verification for voice messages and audio calls. Requires the
full stack running (`npm run dev` → `tsx server.ts`: Next + Socket.io on one
port) with a working database and two seeded demo users.

## 0. Prerequisites

- `npm run dev` serving on `APP_URL` (default `http://localhost:3000`).
- Two demo users with verified emails, e.g. **Alice** and **Bob** (see seed data).
- Two separate browser contexts so sessions/cookies don't collide:
  - Browser A: normal window, logged in as Alice.
  - Browser B: **incognito/private window** (or a different browser), logged in as Bob.
- `CallProvider` mounted in the app shell (see `components/calls/index.ts`
  for the one-line integration) with each user's `{ id, name, avatarUrl }`.
- Microphone permission: allow when prompted. A virtual mic / loopback is
  fine for verifying media flow; the call timer + quality dot prove the
  peer connection is live.

## 1. Voice messages (single client is enough)

1. Open a conversation as Alice; click the mic button in the composer.
2. **Permission denial:** on first run, click "Block" in the browser prompt →
   expect the red error card "Microphone access denied" with retry
   instructions → click "Try again", allow, recording starts.
3. **Record:** hold the button (or tap to toggle) → live waveform animates,
   elapsed timer counts. Speak for ~5s, release.
4. **Preview:** the AudioPlayer appears with a mini waveform → press play,
   seek by clicking the waveform, change speed to 1.5x.
5. **Send:** click "Send voice message" → message appears in the thread as a
   VOICE message with a working player (Bob sees it in realtime via
   `message:new`).
6. **Cancel:** start another recording, press Esc → returns to idle, nothing sent.
7. **Limits:** recordings stop automatically at 5:00 with a notice.

## 2. Audio call — happy path (2 clients)

1. **A dials B:** as Alice, open the DM with Bob → call button →
   `POST /api/calls` → outgoing CallWindow shows "Ringing…".
2. **B rings:** Bob's window shows the incoming CallWindow with Alice's name/
   avatar + ringtone (allow audio: click once anywhere if the browser blocked
   autoplay — the ringtone resumes on first gesture).
3. **B accepts:** both windows switch to active → timer starts, quality dot
   appears (green within ~5s on localhost), mute/unmute works on both ends.
4. **Talk:** confirm two-way audio. Mute Alice → Bob hears silence; the mute
   button shows pressed state.
5. **Minimize:** Alice minimizes → pill with timer/quality in the corner;
   expand restores the full window.
6. **B hangs up:** both windows close; Alice sees an info toast "Call ended".
7. **History:** both users open Call History → the call appears with correct
   direction (outgoing for Alice, incoming for Bob), duration ≈ elapsed time,
   status ENDED. Alice's redial button starts a new call to Bob.

## 3. Call — edge cases

| # | Steps | Expected |
|---|-------|----------|
| 1 | B declines A's call | A: toast "Call declined"; both histories show DECLINED |
| 2 | A calls, B never answers (45s) | Server marks MISSED, B gets a `CALL_MISSED` notification; A sees "No answer", B sees "Missed call" |
| 3 | B is already on a call with Carol when A calls | A is auto-declined (busy); B gets a toast "…called while you were on another call" |
| 4 | A starts a call, then kills their network (devtools offline) mid-call | ICE `disconnected` → grace period → `reconnecting` state; restore network → ICE restart → "connected" resumes. If unrestorable: failed window with "Try again" (redial works) |
| 5 | B denies mic on accept | B sees "Microphone unavailable" failure; A is notified the call failed (no endless ringing) |
| 6 | A reloads the page mid-call | Best-effort `call:hangup` fires on unload; B's window closes with "Call ended"; history shows ENDED |
| 7 | Browser without WebRTC (or `RTCPeerConnection` blocked) | Start/accept shows the "not supported" failure with a clear message — no crash |
| 8 | Non-participant opens `/api/calls/<id>` directly | 403 FORBIDDEN (participant gate in `lib/services/calls.ts`) |
| 9 | Non-participant opens `/api/calls/history` | Only their own calls are returned (200, filtered list) |

## 4. What to watch in the server logs

- `call:ring` → `call:incoming` emitted to `user:{bobId}` room.
- `call:accept` → DB `Call.status` → `ONGOING`, `call:accepted` fanned out.
- `call:hangup` / ring timeout → `Call.status` → `ENDED`/`MISSED` with `endedAt`;
  `CallParticipant.leftAt` set. History reads derive from these rows.

## 5. Known dev-environment limitations

- **No TURN server provisioned in dev** (`.env.example` documents
  `NEXT_PUBLIC_TURN_*`). Calls between two localhost tabs or LAN peers work
  over host/SRFLX candidates; symmetric-NAT traversal in production needs
  TURN — provision before launch.
- Ringtone requires a user gesture in some browsers before the AudioContext
  may start; the hook retries on first pointer/key interaction.
- Group calls: mesh is implemented (initiator offers per peer, ≤6 enforced),
  but multi-client group testing needs 3+ browsers — covered by unit tests
  for the state machine, not yet by a manual pass.
