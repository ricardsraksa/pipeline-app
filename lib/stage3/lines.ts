// One plain line per image prompt — what the picture shows — for the prompt
// cards ("Dog lying in the stand while its owner trims its nails"). Read from
// the finished prompt by a cheap model, so the line always matches what will
// be generated; the prompt writer itself is untouched. Each line is stored
// with a key of the prompt it came from, so only changed prompts are redone.
import type { Run } from "@/lib/db";
import { recordUsage, updateRun } from "@/lib/db";
import { anthropicClient } from "@/lib/anthropic-client";
import { getModel, streamToolCall } from "@/lib/models";
import type { RemainingPrompt } from "@/lib/stage3/hero";

const anthropic = anthropicClient({ timeout: 60_000 });

type Stored = Record<string, { key: string; line: string }>;

function keyOf(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const TOOL = {
  name: "submit_lines",
  description: "Submit one line per image.",
  input_schema: {
    type: "object" as const,
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, line: { type: "string" } },
          required: ["index", "line"],
        },
      },
    },
    required: ["lines"],
  },
};

const SYSTEM = `Each item is an image-generation prompt for a product photo. For each, write ONE plain line of at most 14 words saying what the picture shows: who or what is in it and what is happening. Example: "Dog lying in the stand while its owner trims its nails". No marketing words, no on-image text, no camera, lighting or style details.`;

/** The current line for each prompt, by index; missing or outdated lines are written now. */
export async function promptLines(run: Run): Promise<Record<number, string>> {
  let prompts: RemainingPrompt[] = [];
  try { prompts = JSON.parse(run.stage3_remaining_prompts_edited ?? run.stage3_remaining_prompts ?? "[]"); } catch { prompts = []; }
  if (!Array.isArray(prompts) || !prompts.length) return {};
  let stored: Stored = {};
  try { stored = JSON.parse(run.stage3_prompt_lines ?? "{}") ?? {}; } catch { stored = {}; }

  const todo = prompts.filter((p) => p?.prompt && stored[String(p.index)]?.key !== keyOf(p.prompt));
  if (todo.length) {
    const model = await getModel("stage3Lines");
    const msg = await streamToolCall(anthropic, {
      model,
      max_tokens: 4000,
      system: SYSTEM,
      tools: [TOOL],
      messages: [{ role: "user", content: todo.map((p) => `IMAGE ${p.index}:\n${p.prompt.slice(0, 6000)}`).join("\n\n---\n\n") }],
    }, "submit_lines", (u) => void recordUsage(run.id, "stage4: image lines", model, u));
    const out = (msg.content.find((b) => b.type === "tool_use")?.input as { lines?: Array<{ index?: unknown; line?: unknown }> } | undefined)?.lines ?? [];
    for (const p of todo) {
      const hit = out.find((l) => Number(l?.index) === p.index);
      const line = typeof hit?.line === "string" ? hit.line.trim().replace(/^["']|["']$/g, "").slice(0, 160) : "";
      if (line) stored[String(p.index)] = { key: keyOf(p.prompt), line };
    }
    await updateRun(run.id, { stage3_prompt_lines: JSON.stringify(stored) });
  }

  const lines: Record<number, string> = {};
  for (const p of prompts) {
    const s = stored[String(p.index)];
    if (s && p?.prompt && s.key === keyOf(p.prompt)) lines[p.index] = s.line;
  }
  return lines;
}
