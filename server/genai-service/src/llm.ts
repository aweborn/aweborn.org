/**
 * Text models via OpenRouter (Phase 07): one key, many models (Claude,
 * DeepSeek, Gemini, Kimi, …) so the planner can be compared across models.
 * OpenAI-compatible chat API; `usage.include` returns the billed cost.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmRequest { model: string; messages: ChatMessage[]; json?: boolean; maxTokens?: number; temperature?: number }
export interface LlmResult { content: string; model: string; costUsd: number; usage: unknown; latencyMs: number }

export const llmConfigured = () => !!process.env.OPENROUTER_API_KEY;

export async function chat(req: LlmRequest, signal?: AbortSignal): Promise<LlmResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("llm_not_configured");
  const started = Date.now();
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://aweborn.org",
      "X-Title": "Aweborn",
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 2500,
      temperature: req.temperature ?? 0.8,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      usage: { include: true },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    model?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${body.error?.message ?? "error"}`.slice(0, 300));
  return {
    content: body.choices?.[0]?.message?.content ?? "",
    model: body.model ?? req.model,
    costUsd: typeof body.usage?.cost === "number" ? body.usage.cost : 0,
    usage: body.usage ?? null,
    latencyMs: Date.now() - started,
  };
}
