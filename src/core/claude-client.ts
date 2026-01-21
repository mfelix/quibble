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
}

interface ResultEvent {
  type: 'result';
  text: string;
}

type ParsedStreamLine = StreamEvent | ResultEvent | null;

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

    const nestedDeltaText = event?.event?.delta?.text;
    if (typeof nestedDeltaText === 'string') {
      return { type: 'delta', text: nestedDeltaText };
    }

    const directDeltaText = event?.delta?.text;
    if (typeof directDeltaText === 'string') {
      return { type: 'delta', text: directDeltaText };
    }

    if (event?.type === 'message' && Array.isArray(event?.content)) {
      const text = event.content
        .filter((item: { type?: string; text?: string }) => item?.type === 'text' && typeof item.text === 'string')
        .map((item: { text: string }) => item.text)
        .join('');
      if (text) {
        return { type: 'result', text };
      }
    }

    // Handle text delta events
    if (
      event.type === 'stream_event' &&
      event.event?.type === 'content_block_delta' &&
      event.event?.delta?.type === 'text_delta'
    ) {
      return { type: 'delta', text: event.event.delta.text };
    }

    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta' &&
      typeof event.delta.text === 'string'
    ) {
      return { type: 'delta', text: event.delta.text };
    }

    // Handle final result
    if (event.type === 'result' && event.result) {
      if (typeof event.result === 'string') {
        return { type: 'result', text: event.result };
      }
    }

    return null;
  } catch {
    return null;
  }
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
    onProgress?: ProgressCallback,
    debugStreamPath?: string
  ): Promise<ClaudeResponse> {
    const prompt = buildClaudeResponsePrompt(originalDocument, codexFeedback);
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
        tokenCount++;
        onProgress(parsed.text, tokenCount);
      } else if (parsed.type === 'result') {
        finalResult = parsed.text;
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
