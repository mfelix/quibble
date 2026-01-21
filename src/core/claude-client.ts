import * as fs from 'node:fs';
import { BaseClient, type ClientOptions, type StreamingCallback } from './base-client.js';
import { parseCliOutput } from '../utils/parsing.js';
import { ClaudeResponseSchema, type ClaudeResponse } from '../types/index.js';
import {
  CLAUDE_RESPONSE_SYSTEM_PROMPT,
  buildClaudeResponsePrompt,
} from '../prompts/index.js';

export type ProgressCallback = (text: string, tokenCount: number) => void;

interface StreamEvent {
  type: 'delta';
  text: string;
  usageTokens?: number;
}

interface ResultEvent {
  type: 'result';
  text: string;
  usageTokens?: number;
}

interface UsageEvent {
  type: 'usage';
  usageTokens: number;
}

type ParsedStreamLine = StreamEvent | ResultEvent | UsageEvent | null;

/**
 * Parse a JSONL line from Claude CLI streaming output.
 * Returns the delta text for stream events, or the final result text.
 */
function parseStreamLine(line: string): ParsedStreamLine {
  try {
    let cleaned = line.trim();
    if (!cleaned) return null;
    if (cleaned.startsWith('data:')) {
      cleaned = cleaned.slice(5).trim();
    }
    if (!cleaned || cleaned === '[DONE]') return null;

    const event = JSON.parse(cleaned);
    const usageTokens = extractUsageTokens(event);

    const nestedDeltaText = event?.event?.delta?.text;
    if (typeof nestedDeltaText === 'string') {
      return { type: 'delta', text: nestedDeltaText, usageTokens };
    }

    const directDeltaText = event?.delta?.text;
    if (typeof directDeltaText === 'string') {
      return { type: 'delta', text: directDeltaText, usageTokens };
    }

    if (event?.type === 'message' && Array.isArray(event?.content)) {
      const text = event.content
        .filter((item: { type?: string; text?: string }) => item?.type === 'text' && typeof item.text === 'string')
        .map((item: { text: string }) => item.text)
        .join('');
      if (text) {
        return { type: 'result', text, usageTokens };
      }
    }

    // Handle text delta events
    if (
      event.type === 'stream_event' &&
      event.event?.type === 'content_block_delta' &&
      event.event?.delta?.type === 'text_delta'
    ) {
      return { type: 'delta', text: event.event.delta.text, usageTokens };
    }

    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta' &&
      typeof event.delta.text === 'string'
    ) {
      return { type: 'delta', text: event.delta.text, usageTokens };
    }

    // Handle final result
    if (event.type === 'result' && event.result) {
      if (typeof event.result === 'string') {
        return { type: 'result', text: event.result, usageTokens };
      }
    }

    if (typeof usageTokens === 'number') {
      return { type: 'usage', usageTokens };
    }

    return null;
  } catch {
    return null;
  }
}

function extractUsageTokens(event: unknown): number | undefined {
  if (!event || typeof event !== 'object') return undefined;
  const data = event as Record<string, unknown>;
  const candidates: Array<Record<string, unknown>> = [];
  const direct = asRecord(data);
  if (direct) candidates.push(direct);
  const message = asRecord(data.message);
  if (message) candidates.push(message);
  const result = asRecord(data.result);
  if (result) candidates.push(result);
  const eventRecord = asRecord(data.event);
  if (eventRecord) {
    candidates.push(eventRecord);
    const nestedMessage = asRecord(eventRecord.message);
    if (nestedMessage) candidates.push(nestedMessage);
  }

  let usage: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    const found = asRecord(candidate.usage);
    if (found) {
      usage = found;
      break;
    }
  }

  if (!usage) return undefined;

  const total = (usage as Record<string, unknown>).total_tokens;
  if (typeof total === 'number') return total;

  const input = (usage as Record<string, unknown>).input_tokens;
  const output = (usage as Record<string, unknown>).output_tokens;
  if (typeof input === 'number' && typeof output === 'number') {
    return input + output;
  }
  if (typeof output === 'number') return output;
  if (typeof input === 'number') return input;

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

export class ClaudeClient extends BaseClient {
  private model: string;

  constructor(options: Partial<ClientOptions & { model?: string }> = {}) {
    super(options);
    this.model = options.model ?? 'opus';
  }

  async respond(
    originalDocument: string,
    codexFeedback: string,
    contextBlock?: string,
    onProgress?: ProgressCallback,
    debugStreamPath?: string
  ): Promise<ClaudeResponse> {
    const prompt = buildClaudeResponsePrompt(originalDocument, codexFeedback, contextBlock);
    const output = await this.runClaude(prompt, onProgress, debugStreamPath);

    const result = parseCliOutput(output, ClaudeResponseSchema);
    if (!result.success) {
      // One retry with a stricter prompt requiring sentinel-wrapped JSON only.
      throw new Error(`Failed to parse Claude response: ${result.error}`);
    }

    return result.data;
  }

  private async runClaude(
    prompt: string,
    onProgress?: ProgressCallback,
    debugStreamPath?: string
  ): Promise<string> {
    const fullPrompt = `${CLAUDE_RESPONSE_SYSTEM_PROMPT}\n\n${prompt}`;

    // If no progress callback, use non-streaming mode
    if (!onProgress) {
      const stdout = await this.exec('claude', [
        '--print',
        '--model', this.model,
        '-p', fullPrompt,
      ]);
      return stdout;
    }

    // Use streaming mode with JSONL output
    let accumulatedText = '';
    let tokenCount = 0;
    let finalResult: string | null = null;
    const debugStream = debugStreamPath
      ? fs.createWriteStream(debugStreamPath, { flags: 'a' })
      : null;

    const handleLine: StreamingCallback = (line) => {
      if (debugStream) {
        debugStream.write(line + '\n');
      }
      const parsed = parseStreamLine(line);
      if (!parsed) return;

      if (parsed.type === 'delta') {
        accumulatedText += parsed.text;
        if (typeof parsed.usageTokens === 'number') {
          tokenCount = parsed.usageTokens;
        } else {
          tokenCount++;
        }
        onProgress(parsed.text, tokenCount);
      } else if (parsed.type === 'result') {
        finalResult = parsed.text;
        if (typeof parsed.usageTokens === 'number') {
          tokenCount = parsed.usageTokens;
          onProgress('', tokenCount);
        }
      } else if (parsed.type === 'usage') {
        tokenCount = parsed.usageTokens;
        onProgress('', tokenCount);
      }
    };

    let stdout = '';
    try {
      stdout = await this.execStreaming(
        'claude',
        [
          '--print',
          '--verbose',
          '--output-format', 'stream-json',
          '--include-partial-messages',
          '--model', this.model,
          '-p', fullPrompt,
        ],
        handleLine,
        debugStream
          ? (source, chunk) => {
            debugStream.write(`[${source} chunk]\n${chunk}\n`);
          }
          : undefined
      );
    } finally {
      if (debugStream) {
        debugStream.end();
      }
    }

    // Use the final result if available, otherwise use accumulated text
    if (finalResult) return finalResult;
    if (accumulatedText) return accumulatedText;
    return stdout;
  }
}
