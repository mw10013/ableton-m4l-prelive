import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import * as Domain from "@/lib/Domain";
import * as LiveSet from "@/lib/LiveSet";
import { runServerFn } from "@/lib/runtime";

export const readClip = createServerFn({ method: "GET" }).handler(() =>
  runServerFn(LiveSet.readClip()),
);

export const readLiveSetOverview = createServerFn({ method: "GET" }).handler(
  () => runServerFn(LiveSet.readLiveSetOverview()),
);

const SlotAddress = Schema.Struct({
  trackIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  slotIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const readClipBySlot = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(SlotAddress))
  .handler(({ data }) => runServerFn(LiveSet.readClipBySlot(data)));

export const togglePlay = createServerFn({ method: "POST" }).handler(() =>
  runServerFn(LiveSet.togglePlay()),
);

export const fireClip = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Domain.ClipIdInput))
  .handler(({ data }) => runServerFn(LiveSet.fireClip(data)));

export const readClipById = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Domain.ClipIdInput))
  .handler(({ data }) => runServerFn(LiveSet.readClipById(data)));

export const replaceNotes = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Domain.ReplaceNotesInput))
  .handler(({ data }) => runServerFn(LiveSet.replaceNotes(data)));
