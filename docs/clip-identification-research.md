# Clip Identification Research

## Question

Can the "Read from Live" button handler determine which clip it's reading notes from, to display the clip name and canonical path?

## Answer

**Yes.** liveql's `Clip` type already exposes both `name` and `path`. The current query already fetches `name` but does **not** fetch `path`. Adding `path` to the query and schema is all that's needed.

## Current State

### Query (`src/lib/liveql.ts:7-22`)

The `readClip` server fn queries `live_set.view.detail_clip` — the clip selected in Ableton's Detail View. It already fetches `name` but not `path`.

```graphql
{ live_set { view { detail_clip {
    id name length is_midi_clip
    signature_numerator signature_denominator
    notes { ... }
} } } }
```

### Schema (`src/lib/Domain.ts:72-80`)

`ClipWithNotes` includes `name` but not `path`:

```ts
export const ClipWithNotes = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  length: Schema.Number,
  is_midi_clip: Schema.Boolean,
  signature_numerator: Schema.Number,
  signature_denominator: Schema.Number,
  notes: Schema.NullOr(Schema.Array(Note)),
});
```

### UI (`src/routes/index.tsx:127-131`)

The clip name is already displayed after reading:

```tsx
{
  clipInfo && (
    <span className="ml-auto text-sm text-muted-foreground">
      {clipInfo.name} ({clipInfo.length} beats)
    </span>
  );
}
```

## What's Available in liveql

From the GraphQL schema (`refs/liveql/liveql-n4m.js:125-138`):

| Field       | Type      | Description                                                    |
| ----------- | --------- | -------------------------------------------------------------- |
| `Clip.name` | `String!` | Clip name in Ableton                                           |
| `Clip.path` | `String!` | LOM canonical path, e.g. `live_set tracks 0 clip_slots 3 clip` |

The `path` string encodes the track index and clip slot index, and is the canonical reference to the clip in the Live Object Model.

## Implementation Path

1. **Add `path` to `ClipWithNotes`** in `src/lib/Domain.ts`
2. **Add `path` to the GraphQL query** in `src/lib/liveql.ts`
3. **Add `path` to `ClipInfo`** interface and state in `src/routes/index.tsx`
4. **Display the path** in the UI alongside the clip name

The path string can also be parsed to extract track index and clip slot index if needed:

```
"live_set tracks 0 clip_slots 3 clip"
         → track index: 0
         → clip slot index: 3
```

## Alternative: Query the Session Grid

A `SongOverview` schema already exists in `src/lib/Domain.ts:86-99` that models the full session grid (`Song → tracks[] → clip_slots[] → clip`). This could be used to query the entire session and match clips by ID, but is overkill for simply identifying the current detail clip.
