// The overflow upstream: when the free Workers AI allowance is used up, the same /v1 calls run on OpenAI with the operator's
// key (a Worker secret). The Flisk rules in front of each public model are the same; the answer keeps the public model name.
import type { ChatMessage } from "./workers-ai";

export function openaiUpstream(opts: { key: string; model: string; publicModel: string; preludes: Record<string, ChatMessage[]>; maxTokens?: number; url?: string; tokenParam?: "max_tokens" | "max_completion_tokens"; fetchImpl?: typeof fetch }) {
  const doFetch = opts.fetchImpl ?? fetch;
  const cap = opts.maxTokens ?? 1024;
  return async (path: string, init: RequestInit): Promise<Response> => {
    if (path === "/v1/models") return Response.json({ object: "list", data: Object.keys(opts.preludes).map((id) => ({ id, object: "model", owned_by: "flisk" })) });
    if (path !== "/v1/chat/completions" || init.method !== "POST") return Response.json({ error: { message: "not found" } }, { status: 404 });
    const body = JSON.parse(String(init.body ?? "{}")) as { model?: string; messages?: ChatMessage[]; max_tokens?: number };
    const publicModel = body.model && Object.hasOwn(opts.preludes, body.model) ? body.model : opts.publicModel;
    const messages = (body.messages ?? []).filter((m) => m && typeof m.content === "string").map((m) => ({ role: String(m.role), content: m.content }));
    if (!messages.length) return Response.json({ error: { message: "messages must not be empty", type: "invalid_request_error" } }, { status: 400 });
    let res: Response;
    try {
      res = await doFetch(opts.url ?? "https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.key}` },
        body: JSON.stringify({ model: opts.model, messages: [...opts.preludes[publicModel], ...messages], [opts.tokenParam ?? "max_completion_tokens"]: Math.min(Number(body.max_tokens) || cap, cap) }),
        signal: init.signal,
      });
    } catch (e) {
      return Response.json({ error: { message: `model call failed: ${(e as Error).message}`, type: "api_error" } }, { status: 502 });
    }
    if (!res.ok) return Response.json({ error: { message: `model call failed with ${res.status}`, type: "api_error" } }, { status: 502 }); // never pass OpenAI's error (it can name the key) on
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const usage = { prompt_tokens: data.usage?.prompt_tokens ?? 0, completion_tokens: data.usage?.completion_tokens ?? 0 };
    return Response.json({
      id: `chatcmpl-${crypto.randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: publicModel,
      choices: [{ index: 0, message: { role: "assistant", content: String(data.choices?.[0]?.message?.content ?? "").trim() }, finish_reason: "stop" }],
      usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
    });
  };
}
