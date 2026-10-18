export class OpenAiError extends Error {
  constructor(status, code) {
    super(`openai_${status}`);
    this.name = "OpenAiError";
    this.status = status;
    this.code = code;
  }
}

// Error bodies are intentionally not propagated: they could echo prompt content.
export async function createChatCompletion({
  apiKey,
  model,
  messages,
  tools,
  maxTokens,
  signal,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: "auto",
      max_completion_tokens: maxTokens,
    }),
    signal,
  });

  if (!response.ok) {
    throw new OpenAiError(response.status, response.status === 429 ? "rate" : "failed");
  }
  const body = await response.json();
  const message = body?.choices?.[0]?.message;
  if (!message) throw new OpenAiError(502, "empty");
  return message;
}
