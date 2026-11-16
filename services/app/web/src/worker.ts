// Cloudflare entry: the portal on a Worker, users and keys in D1, the model on Workers AI. Deploy: see DEPLOY.md.
import modelfile from "../../../../deploy/Modelfile";
import { type D1, d1Store } from "./d1-store";
import { catalogResponse } from "./catalog";
import { createPortal } from "./portal";
import { withSecurityHeaders } from "./security-headers";
import { type AiBinding, parseModelfile, workersAiUpstream } from "./workers-ai";

interface Env {
  DB: D1; AI: AiBinding; ASSETS: { fetch(req: Request): Promise<Response> };
  PUBLIC_URL: string; MODEL: string; PUBLIC_MODEL: string; CHAT_MODEL?: string; CHAT_BASE_MODEL?: string; DAILY_LIMIT?: string; SPONSOR_URL?: string; DAILY_NEURONS?: string; PORTAL_NAME?: string; ALLOWED_LOGINS?: string;
  GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; SESSION_SECRET: string;
}

// Workers AI neurons per token, [in, out], from Cloudflare's price list (neurons per million tokens / 1,000,000).
// A base model missing here is counted at the dearest rate, so a new model can never overspend the allowance unseen.
const RATES: Record<string, [number, number]> = {
  "@cf/qwen/qwen2.5-coder-32b-instruct": [0.06, 0.0909],
  "@cf/qwen/qwen3-30b-a3b-fp8": [0.004625, 0.030475],
};
const DEAREST: [number, number] = [0.06, 0.0909];
// The chat model's answers may be longer: a whole web page does not fit in 1,024 tokens, and its output is cheap.
const CHAT_MAX_TOKENS = 2048;

let portal: ReturnType<typeof createPortal> | undefined;
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await handle(req, env));
  },
};

function handle(req: Request, env: Env): Promise<Response> {
  {
    // The public model list for Flisk apps: no key needed, nothing secret in it.
    if (req.method === "GET" && new URL(req.url).pathname === "/v1/catalog") return Promise.resolve(catalogResponse());
    const [perInputToken, perOutputToken] = RATES[env.MODEL] ?? DEAREST;
    // The chat model on its own base model: Qwen3 answers at once with "/no_think" (its thinking would use up the answer).
    const chatBase = env.CHAT_MODEL && env.CHAT_BASE_MODEL ? env.CHAT_BASE_MODEL : undefined;
    const [chatIn, chatOut] = chatBase ? (RATES[chatBase] ?? DEAREST) : DEAREST;
    portal ??= createPortal({
      name: env.PORTAL_NAME ?? "Flisk Inference",
      publicUrl: env.PUBLIC_URL,
      store: d1Store(env.DB, () => env.SESSION_SECRET),
      upstream: workersAiUpstream({ ai: env.AI, model: env.MODEL, publicModel: env.PUBLIC_MODEL, prelude: parseModelfile(modelfile), others: env.CHAT_MODEL ? { [env.CHAT_MODEL]: [] } : {},
        overrides: env.CHAT_MODEL && chatBase ? { [env.CHAT_MODEL]: { model: chatBase, systemSuffix: chatBase.includes("qwen3") ? "\n/no_think" : undefined, maxTokens: CHAT_MAX_TOKENS } } : {} }),
      allowedModels: [env.PUBLIC_MODEL, ...(env.CHAT_MODEL ? [env.CHAT_MODEL] : [])],
      github: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : undefined,
      allowedLogins: (env.ALLOWED_LOGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      dailyLimit: Number(env.DAILY_LIMIT) || undefined,
      sponsorUrl: env.SPONSOR_URL || undefined,
      dailyNeurons: Number(env.DAILY_NEURONS) ? { budget: Number(env.DAILY_NEURONS), perInputToken, perOutputToken,
        models: env.CHAT_MODEL && chatBase ? { [env.CHAT_MODEL]: { perInputToken: chatIn, perOutputToken: chatOut, maxOutputTokens: CHAT_MAX_TOKENS } } : {} } : undefined,
      beta: true,
      asset: (path) => env.ASSETS.fetch(new Request(new URL(path, env.PUBLIC_URL))),
      indexHtml: async () => (await env.ASSETS.fetch(new Request(new URL("/index.html", env.PUBLIC_URL)))).text(),
    });
    return portal.fetch(req);
  }
}
