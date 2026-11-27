import { defineTool } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { compose } from "../sandbox/docker.ts";
import type { Spec } from "../types.ts";

export function describeSpec(spec: Spec): string {
  return [
    `Idea: ${spec.idea}`,
    "Deliverables:",
    ...spec.deliverables.map((d) => `- ${d.id}: ${d.does}\n  check: ${d.check}`),
    `Decisions: ${spec.areas.map((a) => `${a.area}: ${a.guess}`).join("; ")}`,
    `People sign in: ${spec.needsAccounts ? "yes" : "no"}`,
    `Not building: ${spec.notBuilding.join(", ") || "-"}`,
    `Constraints: ${spec.constraints.join(", ") || "-"}`,
  ].join("\n");
}

/** Files placed in a prompt up front, because each read the model makes costs a request. */
export function fileBlocks(base: string, files: string[]): string {
  return files.filter((file) => existsSync(join(base, file)))
    .map((file) => `<file path="${file}">\n${readFileSync(join(base, file), "utf8")}</file>`)
    .join("\n");
}

export const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });

export function appLogsTool(dir: string, exec = compose, service = "web") {
  return defineTool({
    name: "app_logs", label: "App logs", description: "Show the last lines of the app server log.",
    parameters: Type.Object({ lines: Type.Optional(Type.Number()) }),
    async execute(_id, { lines }) {
      const { output } = await exec(dir, ["logs", "--no-color", "--tail", String(lines ?? 60), service]);
      return textResult(output.slice(-8000) || "(no log yet)");
    },
  });
}
