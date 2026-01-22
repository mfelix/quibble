import * as path from 'node:path';
import * as os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs';
import { BaseClient, type ClientOptions, type StreamingCallback } from './base-client.js';
import { parseCliOutput, extractCodexAssistantMessage } from '../utils/parsing.js';
import {
  CodexReviewSchema,
  CodexConsensusSchema,
  SummariesSchema,
  type CodexReview,
  type CodexConsensus,
  type Summaries,
} from '../types/index.js';
import {
  CODEX_REVIEW_SYSTEM_PROMPT,
  buildCodexReviewPrompt,
  CODEX_CONSENSUS_SYSTEM_PROMPT,
  buildCodexConsensusPrompt,
  CODEX_SUMMARIZE_SYSTEM_PROMPT,
  buildCodexSummarizePrompt,
} from '../prompts/index.js';

export class CodexClient extends BaseClient {
  private model: string | undefined;

  constructor(options: Partial<ClientOptions & { model?: string }> = {}) {
    super(options);
    this.model = options.model; // undefined = use codex CLI default
  }

  async review(
    documentContent: string,
    contextBlock?: string,
    onProgress?: (text: string, tokenCount: number | null, status?: string) => void,
    debugStreamPath?: string
  ): Promise<CodexReview> {
    const prompt = buildCodexReviewPrompt(documentContent, contextBlock);
    const output = await this.runCodex(prompt, CODEX_REVIEW_SYSTEM_PROMPT, onProgress, debugStreamPath);

    const result = parseCliOutput(output, CodexReviewSchema);
    if (!result.success) {
      // One retry with a stricter prompt requiring sentinel-wrapped JSON only.
      throw new Error(`Failed to parse Codex review: ${result.error}`);
    }

    return result.data;
  }

  async checkConsensus(
    originalDocument: string,
    originalFeedback: string,
    authorResponses: string,
    updatedDocument: string,
    contextBlock?: string,
    onProgress?: (text: string, tokenCount: number | null, status?: string) => void
  ): Promise<CodexConsensus> {
    const prompt = buildCodexConsensusPrompt(
      originalDocument,
      originalFeedback,
      authorResponses,
      updatedDocument,
      contextBlock
    );
    const output = await this.runCodex(prompt, CODEX_CONSENSUS_SYSTEM_PROMPT, onProgress);

    const result = parseCliOutput(output, CodexConsensusSchema);
    if (!result.success) {
      // One retry with a stricter prompt requiring sentinel-wrapped JSON only.
      throw new Error(`Failed to parse Codex consensus: ${result.error}`);
    }

    return result.data;
  }

  async summarizeItems(
    items: Array<{ id: string; description: string }>
  ): Promise<Summaries> {
    const prompt = buildCodexSummarizePrompt(items);
    const output = await this.runCodex(prompt, CODEX_SUMMARIZE_SYSTEM_PROMPT);

    const result = parseCliOutput(output, SummariesSchema);
    if (!result.success) {
      throw new Error(`Failed to parse Codex summaries: ${result.error}`);
    }

    return result.data;
  }

  private async runCodex(
    prompt: string,
    systemPrompt: string,
    onProgress?: (text: string, tokenCount: number | null, status?: string) => void,
    debugStreamPath?: string
  ): Promise<string> {
    const outputFile = path.join(os.tmpdir(), `quibble-codex-${uuidv4()}.txt`);

    try {
      const fullPrompt = `${systemPrompt}\n\n${prompt}`;

      const args = [
        'exec',
        '--skip-git-repo-check',
        '--json',
        '-o', outputFile,
      ];

      // Only add -m flag if a custom model was specified
      if (this.model) {
        args.push('-m', this.model);
      }

      args.push(fullPrompt);

      let lastText: string | null = null;
      let tokenCount: number | null = null;
      let lastEmittedTokens: number | null = null;
      let lastStatus: string | null = null;

      const debugStream = debugStreamPath
        ? fs.createWriteStream(debugStreamPath, { flags: 'a' })
        : null;

      const handleLine: StreamingCallback = (line) => {
        if (debugStream) {
          debugStream.write(line + '\n');
        }
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line);
          const text = extractCodexText(event);
          const tokens = extractCodexTokens(event);
          const status = extractCodexStatus(event);
          if (typeof tokens === 'number') {
            tokenCount = tokens;
          }
          if (onProgress && typeof tokenCount === 'number' && tokenCount !== lastEmittedTokens) {
            lastEmittedTokens = tokenCount;
            if (!text) {
              onProgress('', tokenCount, status ?? undefined);
            }
          }
          if (onProgress && status && status !== lastStatus) {
            lastStatus = status;
            onProgress('', tokenCount, status);
          }
          if (text) {
            lastText = text;
            if (onProgress) onProgress(text, tokenCount);
          }
        } catch {
          // Ignore non-JSON lines
        }
      };

      let stdout = '';
      try {
        stdout = onProgress
          ? await this.execStreaming(
            'codex',
            args,
            handleLine,
            debugStream
              ? (source, chunk) => {
                debugStream.write(`[${source} chunk]\n${chunk}\n`);
              }
              : undefined
          )
          : await this.exec('codex', args);
      } finally {
        if (debugStream) {
          debugStream.end();
        }
      }

      try {
        const fileContent = await fs.promises.readFile(outputFile, 'utf-8');
        if (fileContent.trim()) return fileContent;
      } catch { /* File may not exist, continue */ }

      const assistantMessage = extractCodexAssistantMessage(stdout);
      if (assistantMessage) return assistantMessage;
      if (lastText) return lastText;

      return stdout;
    } finally {
      try { await fs.promises.unlink(outputFile); } catch { /* Ignore cleanup errors */ }
    }
  }
}

function extractCodexText(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const data = event as Record<string, unknown>;

  const content = data.content;
  if (typeof content === 'string') return content;

  const message = data.message as Record<string, unknown> | undefined;
  if (message) {
    const msgContent = message.content;
    if (typeof msgContent === 'string') return msgContent;
    if (Array.isArray(msgContent)) {
      const text = msgContent
        .filter((item) => typeof item === 'object' && item && (item as { type?: string }).type === 'text')
        .map((item) => (item as { text?: string }).text)
        .filter((item) => typeof item === 'string')
        .join('');
      if (text) return text;
    }
  }

  return null;
}

function extractCodexTokens(event: unknown): number | null {
  if (!event || typeof event !== 'object') return null;
  const data = event as Record<string, unknown>;
  const usage = data.usage as Record<string, unknown> | undefined;
  if (usage) {
    const total = usage.total_tokens;
    if (typeof total === 'number') return total;
    const output = usage.output_tokens;
    if (typeof output === 'number') return output;
    const input = usage.input_tokens;
    if (typeof input === 'number') return input;
  }
  return null;
}

function extractCodexStatus(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const data = event as Record<string, unknown>;
  const type = data.type;
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'thread.started':
      return 'starting';
    case 'turn.started':
      return 'thinking';
    case 'item.started':
      return 'drafting';
    case 'item.completed':
      return 'finalizing';
    case 'turn.completed':
      return 'done';
    default:
      return null;
  }
}
