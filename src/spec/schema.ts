import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const AREA_NAMES = ["users", "visibility", "data", "services", "core"] as const;

export const SpecSchema = Type.Object({
  idea: Type.String({ description: "One line: what the app is" }),
  areas: Type.Array(Type.Object({
    area: StringEnum(AREA_NAMES),
    guess: Type.String({ description: "Your best reading" }),
    other: Type.String({ description: "The other likely reading" }),
    builtDifferently: Type.Boolean({ description: "Would the two readings be built differently?" }),
    settledBy: Type.Union([Type.String(), Type.Null()], {
      description: "Exact quote of the user's words that settle it, else null",
    }),
    question: Type.String({ description: "Short plain question to ask the user" }),
  }), { description: "One entry for each of the five areas" }),
  deliverables: Type.Array(Type.Object({
    id: Type.String({ description: "D1, D2, ..." }),
    does: Type.String(),
    source: StringEnum(["said", "asked", "assumed"] as const),
    check: Type.String({ description: "What a browser can do and observe to prove it works" }),
  })),
  notBuilding: Type.Array(Type.String()),
  constraints: Type.Array(Type.String()),
  needsAccounts: Type.Boolean(),
});
