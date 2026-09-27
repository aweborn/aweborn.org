import { createRun, completeRun, failRun, type Agent } from "./db.js";

// ── Types ────────────────────────────────────────────────────────────

export interface EngineConfig {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  api_url?: string;
  api_key?: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// ── Default configuration ────────────────────────────────────────────

const DEFAULT_CONFIG: Required<EngineConfig> = {
  model: process.env.LLM_MODEL ?? "gpt-4o-mini",
  temperature: 0.7,
  max_tokens: 1024,
  api_url:
    process.env.LLM_API_URL ?? "https://api.openai.com/v1/chat/completions",
  api_key: process.env.LLM_API_KEY ?? "",
};

// ── Engine ───────────────────────────────────────────────────────────

export async function executeAgent(
  agent: Agent,
  trigger: "schedule" | "manual" | "message",
  input?: string
): Promise<string> {
  const run = createRun(agent.id, trigger, input);
  const startTime = Date.now();

  try {
    const agentConfig: EngineConfig = JSON.parse(agent.config || "{}");
    const config = { ...DEFAULT_CONFIG, ...agentConfig };

    if (!config.api_key) {
      throw new Error(
        "No LLM API key configured. Set LLM_API_KEY env var or agent config.api_key"
      );
    }

    const messages: ChatMessage[] = [
      { role: "system", content: agent.prompt },
    ];

    if (input) {
      messages.push({ role: "user", content: input });
    } else {
      // For scheduled runs with no explicit input, provide context
      messages.push({
        role: "user",
        content: `Execute your task. Current time: ${new Date().toISOString()}`,
      });
    }

    console.log(
      `[engine] running agent "${agent.name}" (${agent.id}) via ${trigger}`
    );

    const response = await fetch(config.api_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.api_key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(
        `LLM API error ${response.status}: ${errBody.slice(0, 500)}`
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const output = data.choices?.[0]?.message?.content ?? "(empty response)";
    const durationMs = Date.now() - startTime;

    completeRun(run.id, output, durationMs);
    console.log(
      `[engine] agent "${agent.name}" completed in ${durationMs}ms`
    );
    return output;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      err instanceof Error ? err.message : String(err);
    failRun(run.id, errorMessage, durationMs);
    console.error(
      `[engine] agent "${agent.name}" failed: ${errorMessage}`
    );
    throw err;
  }
}
