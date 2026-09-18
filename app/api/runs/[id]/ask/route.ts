import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/auth";
import { getRun, updateRun, recordUsage } from "@/lib/db";
import { getModel } from "@/lib/models";
import { buildProductContext } from "@/lib/assistant/context";

// The question assistant: ask anything about one product and get an answer
// grounded in everything its run knows. The answer streams back as plain text
// and is saved on the run as it finishes — closing the panel mid-answer does
// not lose it.
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 });

interface Turn { q: string; a: string; at: string }

const SYSTEM = `You are the operator's advisor for ONE product in their DTC store's launch pipeline. Everything the pipeline knows about this product is given to you below: the supplier listing (options, SKUs, specs, the text printed in the listing images), the operator's description, pricing, research, the chosen angle, the copy, the images and the ads, and what the operator has corrected by hand.

The store sells physical products, mostly sourced from AliExpress, on Shopify, to a US-led English-speaking audience whose core buyer is a middle-aged mother. Bundles are sold through the Kaching Bundles app. Prices are set outside the copy.

How to answer:
- Give a recommendation, not a survey. Say what you would do for THIS product and why, in the fewest words that carry it. If two options are close, say which you'd pick and what would change your mind.
- Be concrete about where things go in Shopify when the question is about setup: variants and options, a size chart (a page, a metafield, or an app), product metafields, collections, and the order values should appear in.
- Use the listing's own facts (sizes, measurements, materials) and quote them where it helps. Never invent a spec, a certification or a measurement the material below doesn't contain. If the answer depends on something it doesn't say, say exactly what is missing and give the best default meanwhile.
- The operator's corrections (under "What the operator changed" and in edited text) override the supplier listing.
- You may search the web when the answer depends on current facts outside this material (a Shopify feature, an app, a regulation, a carrier rule). Don't search for things the material already answers.
- Plain text. Short paragraphs; lists as lines starting with "- ". No headings, no bold, no preamble, no sign-off.`;

const WEB_SEARCH = { type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 3, user_location: { type: "approximate" as const, country: "US" } };

function readThread(raw: string | null | undefined): Turn[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is Turn => !!t && typeof t.q === "string" && typeof t.a === "string") : [];
  } catch { return []; }
}

async function runIdOf(context: { params: Promise<unknown> }): Promise<number | null> {
  const { id } = (await context.params) as { id: string };
  const n = parseInt(id, 10);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const runId = await runIdOf(context);
  if (runId === null) return Response.json({ error: "Invalid run id" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({ thread: readThread(run.assistant_thread) });
}

export async function DELETE(req: Request, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const runId = await runIdOf(context);
  if (runId === null) return Response.json({ error: "Invalid run id" }, { status: 400 });
  await updateRun(runId, { assistant_thread: null });
  return Response.json({ success: true });
}

export async function POST(req: Request, context: { params: Promise<unknown> }) {
  const denied = requireSession(req);
  if (denied) return denied;
  const runId = await runIdOf(context);
  if (runId === null) return Response.json({ error: "Invalid run id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { question?: unknown };
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 4000) : "";
  if (question.length < 2) return Response.json({ error: "Ask a question" }, { status: 400 });
  const run = await getRun(runId);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });

  const thread = readThread(run.assistant_thread);
  // The product context is large and stable between questions: cache it (1h)
  // so a follow-up pays for the new question, not the whole run again.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM },
    { type: "text", text: `THE PRODUCT\n\n${buildProductContext(run)}`, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];
  const messages: Anthropic.MessageParam[] = [
    ...thread.slice(-8).flatMap((t) => [
      { role: "user" as const, content: t.q },
      { role: "assistant" as const, content: t.a },
    ]),
    { role: "user", content: question },
  ];
  const model = await getModel("assistant");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let open = true;
      const send = (s: string) => { if (!open) return; try { controller.enqueue(encoder.encode(s)); } catch { open = false; } };
      try {
        const s = anthropic.messages.stream({ model, max_tokens: 16_000, system, messages, tools: [WEB_SEARCH] });
        s.on("text", (t) => { answer += t; send(t); });
        const msg = await s.finalMessage();
        void recordUsage(runId, "assistant: question", model, msg.usage);
        if (!answer.trim()) { answer = "(no answer came back — ask again)"; send(answer); }
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        answer = answer ? `${answer}\n\n(stopped: ${m})` : `(couldn't answer: ${m})`;
        send(answer.startsWith("(couldn't") ? answer : `\n\n(stopped: ${m})`);
      } finally {
        // Saved whether or not anyone is still reading.
        try {
          const fresh = await getRun(runId);
          const next = [...readThread(fresh?.assistant_thread), { q: question, a: answer.trim(), at: new Date().toISOString() }].slice(-30);
          await updateRun(runId, { assistant_thread: JSON.stringify(next) });
        } catch (e) { console.error("[assistant] could not save the answer:", e); }
        if (open) { try { controller.close(); } catch { /* already closed */ } }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
