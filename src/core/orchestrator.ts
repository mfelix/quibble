import * as fs from 'node:fs';
import * as path from 'node:path';
import type { QuibbleConfig } from '../cli/config.js';
import type { SessionManager } from '../state/session.js';
import type { EventEmitter } from './events.js';
import { CodexClient } from './codex-client.js';
import { ClaudeClient } from './claude-client.js';
import { buildContext } from '../context/collector.js';
import type { CodexReview, ClaudeResponse, CodexConsensus, SessionStatus, RoundTimings } from '../types/index.js';

export interface OrchestratorResult {
  status: SessionStatus;
  exitCode: 0 | 1 | 2;
  finalDocument: string;
  totalRounds: number;
}

export class Orchestrator {
  private codexClient: CodexClient;
  private claudeClient: ClaudeClient;
  private currentDocument: string = '';
  private previousFeedbackHash: string | null = null;
  private debugClaudeDir?: string;
  private debugCodexDir?: string;
  private keepDebug: boolean;

  constructor(
    private config: QuibbleConfig,
    private session: SessionManager,
    private events: EventEmitter,
    options: { debugClaudeDir?: string; debugCodexDir?: string; keepDebug?: boolean } = {}
  ) {
    this.codexClient = new CodexClient({
      workingDirectory: process.cwd(),
      verbose: config.verbose,
    });
    this.claudeClient = new ClaudeClient({
      workingDirectory: process.cwd(),
      verbose: config.verbose,
    });
    this.debugClaudeDir = options.debugClaudeDir;
    this.debugCodexDir = options.debugCodexDir;
    this.keepDebug = options.keepDebug ?? false;
  }

  async run(): Promise<OrchestratorResult> {
    this.currentDocument = await fs.promises.readFile(this.config.inputFile, 'utf-8');
    const { round: startRound, phase: startPhase } = await this.session.findResumePoint();

    this.events.emitStart(
      this.session.getSessionId(),
      this.config.inputFile,
      this.config.outputFile,
      this.config.maxRounds
    );

    const sessionStartMs = this.parseSessionStart();
    let currentRound = startRound;
    let currentPhase = startPhase;

    // Load document from previous round if resuming
    if (currentRound > 1) {
      const prevDoc = await this.session.loadDocument(currentRound - 1);
      if (prevDoc) this.currentDocument = prevDoc;
    }

    while (currentRound <= this.config.maxRounds) {
      this.events.emitRoundStart(currentRound);
      await this.session.startRound(currentRound);
      const roundStartMs = Date.now();

      const contextResult = await buildContext(this.currentDocument, this.config.inputFile, {
        maxFiles: this.config.contextMaxFiles,
        maxFileBytes: this.config.contextMaxFileBytes,
        maxTotalBytes: this.config.contextMaxTotalBytes,
      });
      const contextBlock = contextResult?.block ?? null;
      if (contextResult) {
        this.events.emitContext(currentRound, contextResult.files, contextResult.totalBytes);
      }

      // Phase 1: Codex Review
      let codexReview: CodexReview;
      let codexTokenCount: number | undefined;
      const codexStartMs = Date.now();
      if (currentPhase === 'codex_review' || currentPhase === 'pending') {
        await this.session.setPhase('codex_review');
        codexReview = await this.runCodexReview(currentRound, contextBlock, (tokens) => {
          codexTokenCount = tokens;
        });
        currentPhase = 'claude_response';
      } else {
        codexReview = (await this.session.loadCodexReview(currentRound))!;
      }
      const codexDurationMs = Date.now() - codexStartMs;

      // Check for stalemate (same feedback as previous round)
      const feedbackHash = this.hashFeedback(codexReview);
      if (this.previousFeedbackHash === feedbackHash) {
        await this.finalizeRoundTiming(currentRound, sessionStartMs, roundStartMs, {
          codex_review_ms: codexDurationMs,
        });
        return this.terminate('max_rounds_reached', currentRound);
      }
      this.previousFeedbackHash = feedbackHash;

      // Phase 2: Claude Response
      let claudeResponse: ClaudeResponse;
      let claudeTokenCount: number | undefined;
      const claudeStartMs = Date.now();
      if (currentPhase === 'claude_response') {
        await this.session.setPhase('claude_response');
        claudeResponse = await this.runClaudeResponse(currentRound, codexReview, contextBlock, (tokens) => {
          claudeTokenCount = tokens;
        });
        currentPhase = 'consensus_check';
      } else {
        claudeResponse = (await this.session.loadClaudeResponse(currentRound))!;
      }
      const claudeDurationMs = Date.now() - claudeStartMs;

      this.currentDocument = claudeResponse.updated_document;
      await this.session.saveDocument(currentRound, this.currentDocument);

      // Phase 3: Consensus Check
      if (currentPhase === 'consensus_check') {
        await this.session.setPhase('consensus_check');

        let consensusTokenCount: number | undefined;
        if (claudeResponse.consensus_assessment.reached) {
          const consensusStartMs = Date.now();
          const consensus = await this.runConsensusCheck(
            currentRound,
            codexReview,
            claudeResponse,
            contextBlock,
            (tokens) => {
              consensusTokenCount = tokens;
            }
          );
          const consensusDurationMs = Date.now() - consensusStartMs;

          if (consensus.verdict === 'approve') {
            this.events.emitConsensus(currentRound, true, []);
            await this.finalizeRoundTiming(currentRound, sessionStartMs, roundStartMs, {
              codex_review_ms: codexDurationMs,
              claude_response_ms: claudeDurationMs,
              consensus_check_ms: consensusDurationMs,
              codex_review_tokens: codexTokenCount,
              claude_response_tokens: claudeTokenCount,
              codex_consensus_tokens: consensusTokenCount,
            });
            return this.terminate('completed', currentRound);
          }

          this.events.emitConsensus(currentRound, false, consensus.new_issues.map(i => i.id));
          await this.finalizeRoundTiming(currentRound, sessionStartMs, roundStartMs, {
            codex_review_ms: codexDurationMs,
            claude_response_ms: claudeDurationMs,
            consensus_check_ms: consensusDurationMs,
            codex_review_tokens: codexTokenCount,
            claude_response_tokens: claudeTokenCount,
            codex_consensus_tokens: consensusTokenCount,
          });
        } else {
          this.events.emitConsensus(
            currentRound,
            false,
            claudeResponse.consensus_assessment.outstanding_disagreements
          );
          await this.finalizeRoundTiming(currentRound, sessionStartMs, roundStartMs, {
            codex_review_ms: codexDurationMs,
            claude_response_ms: claudeDurationMs,
            codex_review_tokens: codexTokenCount,
            claude_response_tokens: claudeTokenCount,
          });
        }
      }

      await this.session.setPhase('complete');
      currentRound++;
      currentPhase = 'pending';
    }

    return this.terminate(this.determineMaxRoundsStatus(), currentRound - 1);
  }

  private async runCodexReview(
    round: number,
    contextBlock?: string | null,
    onTokens?: (tokens: number) => void
  ): Promise<CodexReview> {
    const debugPath = this.debugCodexDir
      ? path.join(this.debugCodexDir, `codex-stream-round-${round}.log`)
      : undefined;
    const review = await this.codexClient.review(
      this.currentDocument,
      contextBlock ?? undefined,
      (text, tokenCount, status) => {
        if (typeof tokenCount === 'number') {
          onTokens?.(tokenCount);
        }
        this.events.emitCodexProgress(round, text, tokenCount, status);
      },
      debugPath
    );
    await this.session.saveCodexReview(round, review);
    this.events.emitCodexReview(
      round,
      review.issues.map(i => ({ id: i.id, severity: i.severity })),
      review.opportunities.map(o => ({ id: o.id, impact: o.impact }))
    );
    return review;
  }

  private async runClaudeResponse(
    round: number,
    codexReview: CodexReview,
    contextBlock?: string | null,
    onTokens?: (tokens: number) => void
  ): Promise<ClaudeResponse> {
    const debugPath = this.debugClaudeDir
      ? path.join(this.debugClaudeDir, `claude-stream-round-${round}.log`)
      : undefined;
    const response = await this.claudeClient.respond(
      this.currentDocument,
      JSON.stringify(codexReview, null, 2),
      contextBlock ?? undefined,
      (text, tokenCount) => {
        onTokens?.(tokenCount);
        this.events.emitClaudeProgress(round, text, tokenCount);
      },
      debugPath
    );
    await this.session.saveClaudeResponse(round, response);

    const agreed: string[] = [];
    const disputed: string[] = [];
    const partial: string[] = [];

    for (const r of response.responses) {
      if (r.verdict === 'agree') agreed.push(r.feedback_id);
      else if (r.verdict === 'disagree') disputed.push(r.feedback_id);
      else partial.push(r.feedback_id);
    }

    this.events.emitClaudeResponse(round, agreed, disputed, partial);
    return response;
  }

  private async runConsensusCheck(
    round: number,
    codexReview: CodexReview,
    claudeResponse: ClaudeResponse,
    contextBlock?: string | null,
    onTokens?: (tokens: number) => void
  ): Promise<CodexConsensus> {
    const originalDoc = await fs.promises.readFile(this.config.inputFile, 'utf-8');
    const consensus = await this.codexClient.checkConsensus(
      originalDoc,
      JSON.stringify(codexReview, null, 2),
      JSON.stringify(claudeResponse.responses, null, 2),
      claudeResponse.updated_document,
      contextBlock ?? undefined,
      (_text, tokenCount) => {
        if (typeof tokenCount === 'number') {
          onTokens?.(tokenCount);
        }
      }
    );
    await this.session.saveConsensusCheck(round, consensus);
    return consensus;
  }

  private async terminate(status: SessionStatus, totalRounds: number): Promise<OrchestratorResult> {
    await this.session.saveFinalDocument(this.currentDocument);
    await fs.promises.writeFile(this.config.outputFile, this.currentDocument, 'utf-8');

    const exitCode = this.statusToExitCode(status);
    await this.session.complete(status);

    const manifest = this.session.getManifest();
    await this.session.saveFinalSummary({
      status,
      exit_code: exitCode,
      total_rounds: totalRounds,
      statistics: manifest.statistics,
    });

    // Cast status to match CompleteEvent type
    const eventStatus = status as 'completed' | 'max_rounds_reached' | 'max_rounds_reached_warning' | 'max_rounds_reached_unsafe';
    this.events.emitComplete(
      eventStatus,
      exitCode,
      totalRounds,
      manifest.statistics,
      this.config.outputFile,
      this.session.getSessionId()
    );

    await this.cleanupDebugLogs(status);

    return {
      status,
      exitCode,
      finalDocument: this.currentDocument,
      totalRounds,
    };
  }

  private async cleanupDebugLogs(status: SessionStatus): Promise<void> {
    if (this.keepDebug) return;
    if (status !== 'completed') return;

    const debugDir = this.debugClaudeDir ?? this.debugCodexDir;
    if (!debugDir) return;

    try {
      const entries = await fs.promises.readdir(debugDir);
      await Promise.all(
        entries.map((entry) => fs.promises.unlink(path.join(debugDir, entry)))
      );
      await fs.promises.rmdir(debugDir);
    } catch {
      // Best-effort cleanup; ignore errors
    }
  }

  private determineMaxRoundsStatus(): SessionStatus {
    const stats = this.session.getManifest().statistics;
    if (stats.critical_unresolved > 0) return 'max_rounds_reached_unsafe';
    if (stats.major_unresolved > 0) return 'max_rounds_reached_warning';
    return 'max_rounds_reached';
  }

  private statusToExitCode(status: SessionStatus): 0 | 1 | 2 {
    switch (status) {
      case 'completed':
      case 'max_rounds_reached':
        return 0;
      case 'max_rounds_reached_warning':
        return 1;
      case 'max_rounds_reached_unsafe':
      case 'failed':
        return 2;
      default:
        return 0;
    }
  }

  private hashFeedback(review: CodexReview): string {
    // Normalize ordering before hashing to avoid false negatives
    const issues = [...review.issues].sort((a, b) =>
      (a.id + a.description).localeCompare(b.id + b.description)
    );
    const opportunities = [...review.opportunities].sort((a, b) =>
      (a.id + a.description).localeCompare(b.id + b.description)
    );

    const content =
      issues.map(i => i.id + i.description).join('|') +
      opportunities.map(o => o.id + o.description).join('|');

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private parseSessionStart(): number {
    const startedAt = this.session.getManifest().started_at;
    const parsed = Date.parse(startedAt);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  private async finalizeRoundTiming(
    round: number,
    sessionStartMs: number,
    roundStartMs: number,
    phaseTimings: Partial<RoundTimings>
  ): Promise<void> {
    const now = Date.now();
    const hasCodexTokens =
      typeof phaseTimings.codex_review_tokens === 'number' ||
      typeof phaseTimings.codex_consensus_tokens === 'number';
    const hasClaudeTokens = typeof phaseTimings.claude_response_tokens === 'number';
    const timings: RoundTimings = {
      codex_review_ms: phaseTimings.codex_review_ms,
      claude_response_ms: phaseTimings.claude_response_ms,
      consensus_check_ms: phaseTimings.consensus_check_ms,
      codex_review_tokens: phaseTimings.codex_review_tokens,
      claude_response_tokens: phaseTimings.claude_response_tokens,
      codex_consensus_tokens: phaseTimings.codex_consensus_tokens,
      codex_total_tokens: hasCodexTokens
        ? (phaseTimings.codex_review_tokens ?? 0) + (phaseTimings.codex_consensus_tokens ?? 0)
        : undefined,
      claude_total_tokens: hasClaudeTokens ? phaseTimings.claude_response_tokens : undefined,
      round_total_ms: now - roundStartMs,
      session_elapsed_ms: now - sessionStartMs,
    };

    await this.session.saveRoundTimings(round, timings);
    this.events.emitRoundComplete(round, timings);
  }
}
