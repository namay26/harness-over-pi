export type Role = "spec" | "builder" | "verifier";

const PRIMARY = "nvidia/nemotron-3-ultra-550b-a55b:free";

export const config = {
  models: {
    spec: process.env.MODEL_SPEC ?? PRIMARY,
    builder: process.env.MODEL_BUILDER ?? PRIMARY,
    verifier: process.env.MODEL_VERIFIER ?? PRIMARY,
  } satisfies Record<Role, string>,
  /** Overridable so a local fake model can stand in during dry runs. */
  modelsFile: process.env.MODELS_FILE,
  /** Most requests one agent step may use before it is stopped. */
  maxRequestsPerRun: { spec: 6, builder: 40, verifier: 14 } satisfies Record<Role, number>,
  /** A model request with no activity for this long is cancelled and retried once. */
  stallMs: Number(process.env.STALL_SECONDS ?? 180) * 1000,
  fallbackModel: "google/gemma-4-31b-it:free",
  dailyRequestLimit: Number(process.env.DAILY_REQUEST_LIMIT ?? 50),
};
