/**
 * Prompt for Codex to summarize issue/opportunity descriptions for display.
 */

export const CODEX_SUMMARIZE_SYSTEM_PROMPT = `You are a precise technical editor. Summarize each item description for a compact CLI table.

Rules:
- Keep meaning intact and do not add new information
- Keep each summary under 64 characters
- Use plain language, no markdown, no bullet prefixes
- Return JSON only in the requested schema`;

export function buildCodexSummarizePrompt(items: Array<{ id: string; description: string }>): string {
  const payload = items.map((item) => ({
    id: item.id,
    description: item.description,
  }));

  return `Summarize the following items.

<items>
${JSON.stringify(payload, null, 2)}
</items>

Return JSON wrapped in <<<QUIBBLE_JSON_START>>> and <<<QUIBBLE_JSON_END>>> with this shape:
{
  "summaries": [
    { "id": "issue-1", "summary": "Short description" }
  ]
}`;
}
