/**
 * Text models via OpenRouter (Phase 07): one key, many models (Claude,
 * DeepSeek, Gemini, Kimi, …) so the planner can be compared across models.
 * OpenAI-compatible chat API; `usage.include` returns the billed cost.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmRequest {
  model: string; messages: ChatMessage[]; json?: boolean; maxTokens?: number; temperature?: number;
  /** Turn reasoning off: quick replies (minds) where hidden thinking would eat max_tokens and latency. */
  noReasoning?: boolean;
  /** Images (data URLs) shown with the last user message (e.g. a model's thumbnail for the body check). */
  images?: string[];
}

/** The messages as sent: the last user message carries the images, if any. */
function withImages(messages: ChatMessage[], images: string[] | undefined): unknown[] {
  if (!images?.length) return messages;
  const last = messages.map((m) => m.role).lastIndexOf("user");
  return messages.map((m, i) =>
    i !== last ? m : { role: m.role, content: [{ type: "text", text: m.content }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] },
  );
}
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
      messages: withImages(req.messages, req.images),
      max_tokens: req.maxTokens ?? 2500,
      temperature: req.temperature ?? 0.8,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      ...(req.noReasoning ? { reasoning: { enabled: false } } : {}),
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
