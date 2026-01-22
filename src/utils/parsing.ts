import { z } from 'zod';

const SENTINEL_START = '<<<QUIBBLE_JSON_START>>>';
const SENTINEL_END = '<<<QUIBBLE_JSON_END>>>';

export type ParseResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: string;
  rawContent: string;
};

/**
 * Extract and parse JSON from CLI output using the parsing algorithm from PRD:
 * 1. Search for content between sentinel markers
 * 2. If not found, attempt direct JSON parse
 * 3. If failed, search for JSON in markdown code fences
 * 4. If failed, search for content between first { and last matching }
 * 5. Validate against Zod schema
 */
export function parseCliOutput<T>(
  output: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): ParseResult<T> {
  const parsed = extractJsonValue(output);

  if (!parsed) {
    return {
      success: false,
      error: 'Failed to extract valid JSON from output',
      rawContent: output,
    };
  }

  // Step 5: Validate against schema
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: `Schema validation failed: ${result.error.message}`,
      rawContent: output,
    };
  }

  return {
    success: true,
    data: result.data,
  };
}

export function extractJsonValue(output: string): unknown | null {
  // Step 1: Try sentinel extraction
  let jsonContent = extractBetweenSentinels(output);

  // Step 2: If no sentinels, try direct parse
  if (!jsonContent) {
    jsonContent = output.trim();
  }

  // Try parsing
  let parsed = tryParseJson(jsonContent);

  // Step 3: If failed, try markdown code fence
  if (!parsed) {
    const fenceContent = extractFromCodeFence(output);
    if (fenceContent) {
      parsed = tryParseJson(fenceContent);
    }
  }

  // Step 4: If still failed, try brace matching
  if (!parsed) {
    const braceContent = extractBraceContent(output);
    if (braceContent) {
      parsed = tryParseJson(braceContent);
    }
  }

  return parsed ?? null;
}

function extractBetweenSentinels(content: string): string | null {
  const startIdx = content.indexOf(SENTINEL_START);
  const endIdx = content.indexOf(SENTINEL_END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  return content.slice(startIdx + SENTINEL_START.length, endIdx).trim();
}

function extractFromCodeFence(content: string): string | null {
  const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  return fenceMatch ? fenceMatch[1].trim() : null;
}

function extractBraceContent(content: string): string | null {
  const firstBrace = content.indexOf('{');
  if (firstBrace === -1) return null;

  for (let i = content.length - 1; i >= firstBrace; i--) {
    if (content[i] === '}') {
      const candidate = content.slice(firstBrace, i + 1);
      if (tryParseJson(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function tryParseJson(content: string): unknown | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Parse Codex JSONL output to extract the final assistant message.
 */
export function extractCodexAssistantMessage(jsonlOutput: string): string | null {
  const lines = jsonlOutput.trim().split('\n');
  let lastAssistantContent: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const event = JSON.parse(line);
      if (event.type === 'assistant_message' || event.type === 'message') {
        if (event.content) {
          lastAssistantContent = event.content;
        } else if (event.message?.content) {
          lastAssistantContent = event.message.content;
        }
      }
    } catch {
      // Not valid JSON line, skip
    }
  }

  return lastAssistantContent;
}
