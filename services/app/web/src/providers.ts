// Providers a person can pick in the cabinet to run their own calls on their own account. All three speak the OpenAI chat format,
// so one upstream (openai.ts) covers them; only the address, the default model and the name of the answer-length field differ.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface Provider { label: string; url: string; defaultModel: string; tokenParam: "max_tokens" | "max_completion_tokens"; keyHint: string }
export const PROVIDERS: Record<string, Provider> = {
  openai: { label: "OpenAI", url: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4o-mini", tokenParam: "max_completion_tokens", keyHint: "sk-…" },
  anthropic: { label: "Claude (Anthropic)", url: "https://api.anthropic.com/v1/chat/completions", defaultModel: "claude-sonnet-4-5", tokenParam: "max_tokens", keyHint: "sk-ant-…" },
  openrouter: { label: "OpenRouter", url: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "openai/gpt-4o-mini", tokenParam: "max_tokens", keyHint: "sk-or-…" },
};

// A saved key is sealed with AES-256-GCM under a key derived from the portal's own secret, so a copy of the database alone shows nothing.
const sealKey = (secret: string) => createHash("sha256").update(`provider-keys:${secret}`).digest();
export function seal(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(secret), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
export function open(secret: string, sealed: string): string | null {
  try {
    const b = Buffer.from(sealed, "base64url");
    const d = createDecipheriv("aes-256-gcm", sealKey(secret), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch { return null; }
}
