// Serves the portal's /v1 API from Cloudflare Workers AI: the Flisk rules and examples from deploy/Modelfile go in
// front of every conversation, and the answer comes back in the OpenAI chat-completions shape.
import { openAiChunks, SSE_HEADERS, wholeAsChunks } from "./sse";
/** Cloudflare's free Workers AI allowance (10,000 neurons a day, error 4006) is account-wide, so it can run out before this portal's own cap.
 *  That is a limit, not a server fault: say so in plain words with a 429 and the reset time, instead of a raw 502 that names a paid plan. */
export function modelFailure(e: unknown): Response {
  const m = (e as Error)?.message ?? String(e);
  if (/\b4006\b|daily free allocation/i.test(m)) return Response.json({ error: { message: "the free beta's model budget is used up for today; it resets at 00:00 UTC", type: "rate_limit_error" } }, { status: 429, headers: { "retry-after": String(Math.max(60, Math.ceil((Date.parse(new Date().toISOString().slice(0, 10)) + 864e5 - Date.now()) / 1000))) } });
  return Response.json({ error: { message: `model call failed: ${m}`, type: "api_error" } }, { status: 502 });
}

export interface ChatMessage { role: string; content: string }
export interface AiBinding { run(model: string, input: Record<string, unknown>): Promise<unknown> }

/** The SYSTEM prompt and MESSAGE examples of an Ollama Modelfile, as chat messages. */
export function parseModelfile(text: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  const re = /^(SYSTEM|MESSAGE (user|assistant)) """([\s\S]*?)"""/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ role: m[2] ?? "system", content: m[3] });
  return out;
}

/** What one public model name may change: its base model, text added to the caller's system message, its output cap. */
export interface ModelOverride { model?: string; systemSuffix?: string; maxTokens?: number; reasoningEffort?: string }

/** Adds `suffix` to the first system message, or puts one in front when there is none. */
function withSystemSuffix(messages: ChatMessage[], suffix: string): ChatMessage[] {
  const at = messages.findIndex((m) => m.role === "system");
  if (at < 0) return [{ role: "system", content: suffix.trim() }, ...messages];
  return messages.map((m, i) => (i === at ? { ...m, content: m.content + suffix } : m));
}

// `others` are more public names, each with its own prelude: "flisk-wolf-chat" has none of the Flisk config rules, for
// general chat (chat.flisk.si). `overrides` lets a public name run on another base model (a cheaper one for chat).
// A call naming no known model gets `publicModel`.
export function workersAiUpstream(opts: { ai: AiBinding; model: string; publicModel: string; prelude: ChatMessage[]; others?: Record<string, ChatMessage[]>; overrides?: Record<string, ModelOverride>; maxTokens?: number }) {
  const defaultMax = opts.maxTokens ?? 1024;
  const preludes: Record<string, ChatMessage[]> = { ...opts.others, [opts.publicModel]: opts.prelude };
  return async (path: string, init: RequestInit): Promise<Response> => {
    if (path === "/v1/models") return Response.json({ object: "list", data: Object.keys(preludes).map((id) => ({ id, object: "model", owned_by: "flisk" })) });
    if (path !== "/v1/chat/completions" || init.method !== "POST") return Response.json({ error: { message: "not found" } }, { status: 404 });
    const body = JSON.parse(String(init.body ?? "{}")) as { model?: string; messages?: ChatMessage[]; max_tokens?: number; reasoning_effort?: string; stream?: boolean };
    const publicModel = body.model && Object.hasOwn(preludes, body.model) ? body.model : opts.publicModel;
    const messages = (body.messages ?? []).filter((m) => m && typeof m.content === "string").map((m) => ({ role: String(m.role), content: m.content }));
    if (!messages.length) return Response.json({ error: { message: "messages must not be empty", type: "invalid_request_error" } }, { status: 400 });
    const over = opts.overrides?.[publicModel] ?? {};
    const maxTokens = over.maxTokens ?? defaultMax;
    // Only a model with a default effort takes one; a caller may ask for low or medium, never the dear xhigh.
    const effort = over.reasoningEffort ? (body.reasoning_effort === "medium" ? "medium" : over.reasoningEffort) : undefined;
    const all = [...preludes[publicModel], ...messages];
    const input = { messages: over.systemSuffix ? withSystemSuffix(all, over.systemSuffix) : all, max_tokens: Math.min(Number(body.max_tokens) || maxTokens, maxTokens), temperature: 0, ...(effort ? { reasoning_effort: effort } : {}) };
    // Words go out as they are made. A thinking model's notes must be cut out of the whole text, so it is sent in one piece.
    if (body.stream && !effort) {
      try {
        const live = (await opts.ai.run(over.model ?? opts.model, { ...input, stream: true })) as ReadableStream<Uint8Array>;
        const out = openAiChunks(live, publicModel);
        return new Response(out, { headers: SSE_HEADERS });
      } catch (e) {
        return modelFailure(e);
      }
    }
    let res: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: Array<{ message?: { content?: string } }> };
    try {
      res = (await opts.ai.run(over.model ?? opts.model, input)) as typeof res;
    } catch (e) {
      return modelFailure(e);
    }
    // Workers AI hands back JSON-looking answers already parsed; OpenAI clients expect the content as text.
    const raw = res.response ?? res.choices?.[0]?.message?.content ?? "";
    // A thinking model's notes are not part of the answer.
    const content = typeof raw === "string" ? raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim() : JSON.stringify(raw, null, 2);
    const usage = { prompt_tokens: res.usage?.prompt_tokens ?? 0, completion_tokens: res.usage?.completion_tokens ?? 0 };
    const done = {
      id: `chatcmpl-${crypto.randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: publicModel,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
    };
    return body.stream ? new Response(wholeAsChunks(done), { headers: SSE_HEADERS }) : Response.json(done);
  };
}
