# MagicRoll Editor

A browser-based video editor for timed HTML compositions. It previews text, image,
and video layers in a responsive 16:9 stage, edits them on a timeline, saves the
composition to Postgres, and exports a playable HTML file.

- **Live app:** https://rishet-video-editor.vercel.app
- **Repository:** https://github.com/Rishet11/browser-video-editor
- **Loom walkthrough:** `TODO_LOOM_URL`

## What is included

- Text, image, and video elements in a responsive 16:9 preview
- Play, pause, stop, scrubbing, and 0.5x / 1x / 2x playback speeds
- One timeline track per layer, with drag-to-move and trim handles
- Split at the playhead, minimum duration validation, and negative-start prevention
- Inspector for timing, geometry, text, and source properties
- Autosave, undo/redo, and keyboard shortcuts for split and history
- Postgres persistence through the requested REST API
- Standalone HTML export that starts playing when opened
- HTML import for the brief's ambiguous “load an HTML composition” requirement

## Quick start

```bash
git clone https://github.com/Rishet11/browser-video-editor
cd browser-video-editor
npm install
cp .env.example .env
# Set DATABASE_URL in .env
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `GROQ_API_KEY` is optional;
without it, the editor works normally and the AI tools show an unavailable state.

```bash
npm test       # 156 tests
npm run build
```

## Architecture

The composition is a serialisable Edit Decision List (EDL): layers, timed elements,
and their display properties. The key contract is a pure function:

```ts
resolveAt(edl, time): VisibleElement[]
```

It returns the elements visible at a given time, in paint order, along with the
local time a renderer needs. The browser preview calls it during playback. Export
embeds the EDL and a small vanilla-JavaScript mirror in the generated file.

```mermaid
flowchart LR
  DB[(Postgres)] --> API[REST API]
  API --> EDL[EDL in Zustand]
  EDL --> R[resolveAt(edl, time)]
  R --> Preview[Editor preview]
  R --> Timeline[Timeline]
  EDL --> Export[Standalone HTML export]
```

This keeps the editor small: move, trim, and split are pure EDL transforms, so
undo/redo is a snapshot stack. A parity test runs the TypeScript and exported
JavaScript timing implementations against the same composition and timestamps.

### Timing model

`start` is a position on the timeline. `trimIn` is an offset inside a source video.
They are deliberately separate. Trimming a video from the left advances both
values; otherwise the trimmed clip would restart from the wrong source frame.

Video playback uses the browser's media clock. The editor only seeks when the
element drifts more than 0.15 seconds from its expected local time. Seeking every
frame causes visible stutter.

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
  type     String
  start    Float
  duration Float
  trimIn   Float  @default(0)
  props    Json
}
```

`Layer.index` controls both paint order and timeline track order. `props` stores
geometry and type-specific fields such as text, media source, and CSS. This avoids
a sparse schema while keeping the persisted composition easy to extend.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/editor/:id` | Load a composition as an EDL |
| `PUT` | `/api/editor/:id` | Replace and save a composition; used by autosave |
| `PATCH` | `/api/editor/:id/element/:elementId` | Update one element |
| `POST` | `/api/editor/:id/split` | Split an element at a time |
| `POST` | `/api/editor/:id/export` | Download standalone HTML |

`PATCH` expresses a small, targeted property update. `PUT` makes autosave
idempotent. Split is a command that creates a second element, so it is a `POST`.
Validation is shared between the editor and the server: starts cannot be negative,
durations cannot be less than 0.5 seconds, and `trimIn` cannot be negative.

## AI assist

The selected AI bonus is **timing suggestions**. It proposes a start and duration
for an existing element, explains the suggestion, and lets the editor apply or
dismiss it one row at a time.

I also included a small **B-roll planner**. It finds uncovered stretches and
returns a shot type plus copyable stock-footage search terms. It does not invent
an asset URL or silently insert a clip. Both tools validate model output before it
reaches the UI, and applied timing changes still pass through the ordinary `PATCH`
route.

## Trade-offs and limitations

- Export embeds the EDL and runtime, but not media binaries. Exported files need
  their referenced media URLs to remain available.
- Video is muted so the exported HTML can autoplay under browser policies.
- Video source duration is not yet available to server validation, so `trimIn` is
  not clamped to the end of a source file.
- The timeline is not virtualised and has no snap-to-grid, zoom, or duplicate.
- `PUT` replaces a composition's layers and elements in one transaction. This is
  simple for a demo-scale document, but a larger collaborative editor would diff
  rows and use per-element conflict resolution.
- There is no authentication. A composition ID is sufficient to access the demo.

## Next steps

For a production workflow, I would generate an EDL from a word-timestamped
transcript, connect B-roll planning to a licensed asset library, and move final
video rendering to a queued worker backed by object storage.

## AI tool usage during development

I used Claude Code for scaffolding, repetitive route/component boilerplate, and
reviewing implementation options. I made the EDL model, timing rules, API shapes,
validation behaviour, and test cases myself, then used the tool to help implement
and iterate on them.
