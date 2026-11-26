export type Role = "spec" | "builder" | "verifier";

const PRIMARY = "nvidia/nemotron-3-ultra-550b-a55b:free";

export const config = {
  models: {
    spec: process.env.MODEL_SPEC ?? PRIMARY,
    builder: process.env.MODEL_BUILDER ?? PRIMARY,
    verifier: process.env.MODEL_VERIFIER ?? PRIMARY,
  } satisfies Record<Role, string>,
  fallbackModel: "google/gemma-4-31b-it:free",
  dailyRequestLimit: Number(process.env.DAILY_REQUEST_LIMIT ?? 50),
};
