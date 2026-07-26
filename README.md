# Browser Video Editor

A browser-based video editor: load a composition, preview it on a responsive 16:9
canvas, edit element timing on a multi-track timeline, persist through a REST API,
and export a standalone HTML file that plays the composition with no server and no
build step.

- **Live app:** https://rishet-video-editor.vercel.app
- **Repo:** https://github.com/Rishet11/browser-video-editor
- **Walkthrough:** `TODO_LOOM_URL`

Everything below is implemented and running at that URL: canvas, playback, the
timeline with drag/trim/split, the properties panel, all five REST routes,
Postgres persistence with autosave, standalone HTML export, and one AI feature.

## Quickstart

```bash
git clone https://github.com/Rishet11/browser-video-editor
cd browser-video-editor
npm install
cp .env.example .env            # set DATABASE_URL to any Postgres instance
npx prisma migrate deploy       # create the schema
npm run db:seed                 # insert the demo composition
npm run dev                     # http://localhost:3000
npm test                        # 110 unit tests: EDL core, export parity, video sync, import, suggestions
```

`GROQ_API_KEY` is optional and only powers the AI timing suggestions panel, which
returns a clear "not configured" state without it. Every other feature works
regardless. If the database is unreachable the editor falls back to a bundled demo
composition and says so in a banner, rather than showing an empty canvas.

### Tests

`npm test` covers the parts where this code can actually be wrong: the visibility
window at its exact boundaries (inclusive at `start`, exclusive at
`start + duration`), that a left-edge trim moves `trimIn` and not just `start`, that
a split's second half inherits the shifted `trimIn`, that rejected transforms return
the identical input reference, the seek-tolerance comparison, the HTML parser's
geometry and entity handling, and the suggestion validator's rejection of malformed
model output.

There is also a test that runs the exported file's vanilla `resolveAt` and the
TypeScript `resolveAt` over the same EDL at the same timestamps, including both
window boundaries, and asserts the visible sets match. That test is what keeps the
"preview and export cannot drift" claim honest rather than aspirational.

I wrote these assertions by hand and chose the cases deliberately. That is worth
saying because in a previous conversation I mentioned not writing tests manually,
and this is the concrete correction.

---

## Architecture

The composition is a serialisable JSON document, an **Edit Decision List (EDL)**.
The editor canvas, the timeline, and the exported standalone HTML file all read it
through one pure function:

```ts
resolveAt(edl: EDL, t: number): VisibleElement[]
```

Given a time `t`, it returns exactly the elements visible at that instant, already
sorted in paint order, each carrying the `localTime` its renderer needs. It touches
no DOM, reads no clock, and mutates nothing.

Three consequences, and they are the reason the design is shaped this way:

**1. The preview and the export cannot drift.** The export is not a second
renderer. It writes the same EDL into a `<script>` tag next to a small vanilla-JS
copy of the same `resolveAt` and the same animation loop. There is one renderer
contract, so there is no class of bug where the exported file disagrees with what
the editor showed.

**2. Undo/redo is nearly free.** Split, trim, and move are pure functions from EDL
to EDL, so history is a stack of snapshots rather than a set of inverse operations.
That is about twenty lines in the Zustand store, not a subsystem.

**3. The API is thin.** It persists an EDL and returns an EDL. No server-side
rendering state, no session, no partial-composition protocol to keep in sync with
the client.

The playback loop is a single `requestAnimationFrame` tick that advances the
playhead by `dt * speed`, calls `resolveAt` once per frame, and writes the result
to the DOM. Speed changes the multiplier, not the tick rate. Scrubbing while paused
calls `resolveAt` once and starts no loop at all.

```
Postgres ──Prisma──> toEDL() ──> REST ──> Zustand store ──> resolveAt(edl, t)
                                              │                    │
                                    pure EDL transforms      ┌─────┼─────┐
                                    (move/trim/split)        │     │     │
                                              │           Canvas Timeline Export
                                         undo/redo
                                       snapshot stack
```

### Rejection is a return value, not an exception

Every EDL transform returns the **same object reference** when an edit is invalid:

```ts
const next = trimElement(edl, id, "start", delta);
if (next === edl) { /* rejected */ }
```

This one convention does a lot of work. An invalid drag is a no-op rather than a
thrown error to catch in an event handler. Rejected edits never enter the undo
stack, so an illegal drag does not silently consume a Ctrl+Z. And the server
detects a bad split with the same check the client uses, instead of reimplementing
the rules.

---

## Data model

```prisma
model Composition {
  id        String   @id @default(cuid())
  name      String
  duration  Float
  width     Int      @default(1920)
  height    Int      @default(1080)
  layers    Layer[]
  updatedAt DateTime @updatedAt
}

model Layer {
  id            String      @id @default(cuid())
  compositionId String
  composition   Composition @relation(fields: [compositionId], references: [id], onDelete: Cascade)
  name          String
  index         Int
  elements      Element[]
}

model Element {
  id       String @id @default(cuid())
  layerId  String
  layer    Layer  @relation(fields: [layerId], references: [id], onDelete: Cascade)
  type     String // "text" | "image" | "video"
  start    Float
  duration Float
  trimIn   Float  @default(0)
  props    Json
}
```

`Layer.index` is both the z-order and the timeline track's vertical position. One
track per layer, 1:1, no separate ordering concept.

### Why `trimIn` is separate from `start`

`start` is where a clip sits on the timeline. `trimIn` is the offset **inside the
source media** where playback begins. They are different quantities, and collapsing
them into one field is the bug that makes trimmed video jump.

Dragging a clip's left edge two seconds to the right means "start two seconds later
into the footage." The timeline position moves, and the source offset has to move
with it, or the clip snaps back to frame zero of the file and plays the wrong two
seconds. So a left-edge trim moves `start`, `trimIn`, and `duration` together,
while a right-edge trim only changes `duration`:

```
trimElement(edl, id, "start", +2)  ->  start += 2,  trimIn += 2,  duration -= 2
trimElement(edl, id, "end",   +2)  ->  duration += 2
```

Splitting has the same requirement: the second half inherits
`trimIn + (atTime - start)`, otherwise the back half of a cut restarts the video
from the beginning.

`props` is a JSON column holding `x`, `y`, `w`, `h`, and per-type fields (`text`,
`src`, `css`). See trade-offs for why that is a JSON blob rather than typed
columns.

---

## API design

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/editor/{id}` | Load composition as an EDL |
| `PUT` | `/api/editor/{id}` | Save whole composition (autosave target) |
| `PATCH` | `/api/editor/{id}/element/{elementId}` | Update one element |
| `POST` | `/api/editor/{id}/split` | Split an element at a time |
| `POST` | `/api/editor/{id}/export` | Render standalone HTML |

The verb choice is deliberate rather than incidental.

**`PATCH` for an element** because it is a partial update to a resource that
already exists and is addressable. A properties-panel edit changes `duration` and
nothing else; sending the whole composition to move one field would make the
request body a lie about the intent.

**`PUT` for the composition** because autosave needs to be idempotent. The client
holds the authoritative EDL in memory, debounces, and replaces the stored
document. Sending the same EDL twice has to be indistinguishable from sending it
once, which is exactly what `PUT` promises and `PATCH` does not.

**`POST` for split** because split is not an update to a resource, it is a command
that **creates** one. One element becomes two, and the second element's id does not
exist until the server responds. That is not idempotent, and it has no natural
target URL, so it is a command endpoint rather than a resource update.

**`POST` for export** for the same reason: it is a computation over the
composition, not a representation of it.

Validation lives in `src/lib/validate.ts` and is imported by both the client and
the route handlers, so the two cannot diverge. A `PATCH` with `duration: 0.2`
returns 400, not a silent 200. Server-side checks are not there because the client
is buggy, they are there because the client is not the only possible caller.

---

## Trade-offs

**0.15s video seek tolerance.** Video elements are not driven from React state
every frame. Each tick computes `target = trimIn + (t - start)` per visible video
and hard-seeks only when `Math.abs(video.currentTime - target) > 0.15`. Below that
threshold the browser's own clock drives playback.

Seeking every frame is the obvious implementation and it stutters badly. Seeks are
asynchronous and not sample-accurate, and a seek issued every 16ms means the
decoder never gets to run a smooth sequence. 0.15s is imperceptible at normal
playback speed but tight enough to correct accumulated drift and to snap
immediately after a scrub jump, which is the case that actually needs correcting.
Entering the visible window calls `play()`, leaving it calls `pause()`, and
`playbackRate` follows the editor's speed setting.

**`props` as a JSON column instead of typed columns.** Text needs `text` and
`css`; image and video need `src`; all three need geometry. Typed columns would
mean either a wide sparse table or three joined subtype tables, and every new
element property would be a migration. The cost is that `props` is not queryable
in SQL and not type-checked at the database boundary, so it is validated at the
API edge instead. For a composition editor, where properties are read as a whole
document and never filtered on, that is the right side of the trade.

**`PUT` replaces layers and elements instead of diffing them.** The transaction
updates the composition's scalar fields, deletes its layers (elements cascade), and
recreates them from the incoming EDL. A real diff would produce fewer writes and
preserve row identity, but it is meaningfully more code and more edge cases for a
document that is a few kilobytes at demo scale. Named here because it is a
deliberate simplification, not an oversight, and it is the first thing I would
change if compositions grew large or if row-level history mattered.

**Split is computed server-side.** The route loads the EDL, calls the same
`splitElement` the client calls, and persists the result. The client could split
locally and `PUT` the whole composition, which would be one fewer endpoint. The
brief asks for the route, and having the server own the operation means a
non-browser client gets the same validation.

---

## An ambiguity in the brief, and how I resolved it

The brief says "load an HTML composition," which admits two readings: load a stored
composition that renders as DOM, or parse a supplied HTML file into elements. I read
it as the former, because the specified data model and REST routes both centre on a
persisted structured composition rather than a file import.

Rather than leave that as a coin flip, the app also accepts a raw HTML file and
parses it into an EDL, so it behaves correctly under either reading.
`POST /api/editor/import` takes `text/html` (or `{ html }` JSON), walks the
`img`/`video`/text-bearing tags, reads `left`/`top`/`width`/`height` off the inline
styles into `x/y/w/h`, puts the remaining declarations into `props.css`, and
persists a new composition through the same `fromEDL` path everything else uses.
`fixtures/sample-composition.html` is a working example.

The parser is deliberately narrow, and the honest caveat is that HTML carries no
timing information at all. So import has to invent it: each element gets its own
layer in DOM order (DOM order becomes z-order, which is how HTML already stacks),
media starts at 0, and text elements are staggered so a demo is not all-at-once.
That is an assumption, not a derivation, and it is the part I would want to
replace with a real answer from whoever wrote the spec.

---

## Known limitations

Stated plainly, including the ones I would rather not mention.

- **Videos are muted.** Browsers block programmatic `play()` on unmuted media, so
  every video element is `muted`. Unmuting would mean gating playback behind a user
  gesture, which the editor's play button could provide but the exported file's
  autoplay could not.
- **The timeline is not virtualised.** Fine at demo scale; past a few hundred
  elements it would need windowing.
- **Multiple simultaneously decoding videos are not load-tested.** The demo
  composition has one video visible at a time. Several full-frame videos decoding
  at once contend for decode bandwidth, and I have not measured where that falls
  over.
- **No auth, no multi-user.** A composition id is a capability: anyone with the id
  can read and overwrite it. There is no per-user ownership and no optimistic
  concurrency, so two tabs editing the same composition will last-write-wins each
  other. That is acceptable for a single-user demo and would be the first thing to
  fix for anything real.
- **`PUT` churns rows.** Delete-then-recreate means row identity is not stable
  across saves, so anything that later wanted per-row history or foreign keys onto
  elements would need the diffing version instead.
- **The AI suggestions are advisory only, and not evaluated.** I check that the
  model's output is well-formed and in-range, not that its timing advice is good.
- **Export inlines the EDL but not the media.** Asset URLs are absolutised to the
  deploying origin, so an exported file plays as long as that origin serves the
  assets. It is standalone in the sense of needing no server of its own, not in the
  sense of being a single self-contained file with embedded media.
- **No snap-to-grid, timeline zoom, or duplicate.** These were the lowest-value
  items on the bonus list and were cut deliberately in favour of the items above
  being solid.
- **Undo/redo is not keyboard-discoverable beyond Ctrl+Z / Ctrl+Shift+Z**, and
  there is no visible history UI.

### Two bugs worth naming, because they explain the design

Both were found by testing against a real database and a real browser rather than
by reading the code, which is the argument for doing that early.

**The trim compounded.** `trimElement` shifts the current value by a delta, but the
drag handler was passing the delta measured from where the drag started, so every
`pointermove` re-applied the whole offset. A drag through 0.1s, 0.2s, 0.3s applied
0.6s of trim. The handler now tracks how much it has already committed and passes
the increment.

**A single drag produced dozens of undo entries.** Every `pointermove` pushed a
history snapshot, so Ctrl+Z rewound one mouse event rather than one gesture. The
store now has `beginDrag`/`endDrag` which suspend history pushes for the duration
of a gesture and record one entry at the end, and record nothing at all if the
gesture was rejected throughout.

---

## Future work

The natural extension of this design is the pipeline that turns raw footage into a
finished cut automatically, and the EDL is what makes that tractable.

Start with a word-timestamped transcript (Whisper or Deepgram) of the uploaded
video. Word-level timings, not sentence-level, because every downstream step needs
to place things to a fraction of a second. That transcript generates an EDL
directly: each caption becomes a text element whose `start` and `duration` come
from the word timings, on its own layer. At that point the existing editor already
works, because a generated EDL is the same object a hand-built one is. That is the
property worth having: the automated pipeline and the manual editor meet at one
data structure instead of at a rendering routine.

From there, run keyword extraction per transcript segment to decide what each
segment is about, and use those keywords to fetch B-roll (a stock API like Pexels,
or generated clips) as video elements on a lower layer, with `trimIn` set to the
usable part of each asset. Overlays and lower-thirds are the same insert operation
against the same EDL.

Rendering a final file is where this stops being a browser problem. Export would
move to a queued worker rather than a request: enqueue a render job, have a
headless worker (FFmpeg for straight composition, Remotion if the compositions stay
React-shaped) resolve the EDL frame by frame using the same timing function, write
the output to object storage, and hand the client a signed URL. The queue is not
optional at that point, because a five-minute render cannot live inside an HTTP
request, and because retries and progress reporting need somewhere to live.

Two things this codebase would need before that: the timeline is not virtualised,
which is fine at demo scale and would need windowing past a few hundred elements;
and multiple simultaneously decoding video elements contend for decode bandwidth in
a browser, which I have not load-tested beyond the demo composition.

---

## AI tool usage

I used Claude Code throughout, and the honest split is that it was most useful
where the work was mechanical and least useful where the work was a design
decision.

Hand-designed, and where the actual thinking went:

- The EDL abstraction, and the decision that preview and export must share one
  timing function rather than being two renderers.
- The `trimIn`/`start` separation and the trim and split semantics that follow
  from it.
- Rejection-by-reference-equality as the uniform convention across the transforms,
  the store, and the API, including the consequence that rejected edits must not
  enter the undo stack.
- The 0.15s seek tolerance and the reasoning about why per-frame seeking stutters.
- The REST verb choices, and why split is a command rather than a resource update.
- Where the persistence boundary sits, so that `toEDL`/`fromEDL` is the only place
  the database shape and the EDL shape touch.

Generated with review, because it is pattern-following work: the CRUD route
handler bodies, the Prisma singleton, Tailwind classes and component scaffolding,
the vitest boilerplate around assertions I chose, and the initial project scaffold.

The unit tests in `src/lib/edl.test.ts` are worth calling out specifically. The
assertions are mine, chosen for the cases where this logic actually breaks: the
boundary at exactly `start + duration` (excluded) versus exactly `start`
(included), that a left-edge trim moves `trimIn` and not just `start`, that a
split's second half inherits the shifted `trimIn`, and that a rejected transform
returns the identical input reference. I checked each of those independently rather
than trusting a green test run.

### The AI feature runs on Groq, not Claude

The spec asks for exactly one AI feature, so this is timing suggestions and
nothing else. I did not have an Anthropic API key available, so it calls Groq's
OpenAI-compatible endpoint with `llama-3.3-70b-versatile`. The provider call is one
function in `src/lib/suggestions.ts` with the base URL, model, and key read at the
top, so pointing it at Anthropic or OpenAI is a change to that function and nothing
else.

The interesting part is not the call, it is the parsing layer, because a model's
JSON is untrusted input. `parseSuggestions` accepts either a bare array or
`{suggestions: [...]}`, strips code fences, coerces numeric strings, and then
discards any suggestion that names an element id which does not exist, fails
`isValidStart`/`isValidDuration`, or would run past the end of the composition. It
reuses the same validators the API uses rather than restating the rules. Malformed
JSON returns an empty list instead of throwing, and applying a suggestion goes
through the normal `PATCH` route, so a hallucinated value cannot bypass validation
on its way into the database. That layer is unit-tested against each of those
failure shapes.

I did not evaluate whether the suggestions are *good*. That would need a rubric and
a held-out set, and it is out of scope here; the claim is only that bad output
cannot corrupt the composition.

---

## A correction, unrelated to the code

In our last conversation I said prompt-cached tokens are stored locally. That was
wrong. The KV cache is held server-side by the provider under a TTL, which is why
the discount only applies inside that window, and why prefix stability matters so
much: a change near the beginning of a prompt invalidates the cached prefix and the
rest is recomputed at full price. I looked it up afterwards and would rather
correct it than leave it standing.
