import type {
  QuibbleEvent,
  SessionStatistics,
} from '../types/index.js';

export type EventHandler = (event: QuibbleEvent) => void;

export class EventEmitter {
  private handlers: EventHandler[] = [];

  subscribe(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  private emit(event: QuibbleEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  emitStart(sessionId: string, inputFile: string, outputFile: string, maxRounds: number): void {
    this.emit({
      type: 'start',
      session_id: sessionId,
      input_file: inputFile,
      output_file: outputFile,
      max_rounds: maxRounds,
      timestamp: new Date().toISOString(),
    });
  }

  emitRoundStart(round: number): void {
    this.emit({
      type: 'round_start',
      round,
      timestamp: new Date().toISOString(),
    });
  }

  emitCodexReview(
    round: number,
    issues: Array<{ id: string; severity: 'critical' | 'major' | 'minor' }>,
    opportunities: Array<{ id: string; impact: 'high' | 'medium' | 'low' }>
  ): void {
    this.emit({
      type: 'codex_review',
      round,
      issues,
      opportunities,
      timestamp: new Date().toISOString(),
    });
  }

  emitClaudeResponse(round: number, agreed: string[], disputed: string[], partial: string[]): void {
    this.emit({
      type: 'claude_response',
      round,
      agreed,
      disputed,
      partial,
      timestamp: new Date().toISOString(),
    });
  }

  emitConsensus(round: number, reached: boolean, outstanding: string[]): void {
    this.emit({
      type: 'consensus',
      round,
      reached,
      outstanding,
      timestamp: new Date().toISOString(),
    });
  }

  emitComplete(
    status: 'completed' | 'max_rounds_reached' | 'max_rounds_reached_warning' | 'max_rounds_reached_unsafe',
    exitCode: 0 | 1 | 2,
    totalRounds: number,
    statistics: SessionStatistics,
    outputFile: string,
    sessionId: string
  ): void {
    this.emit({
      type: 'complete',
      status,
      exit_code: exitCode,
      total_rounds: totalRounds,
      statistics: {
        total_issues_raised: statistics.total_issues_raised,
        issues_resolved: statistics.issues_resolved,
        issues_disputed: statistics.issues_disputed,
        critical_unresolved: statistics.critical_unresolved,
        major_unresolved: statistics.major_unresolved,
        total_opportunities_raised: statistics.total_opportunities_raised,
        opportunities_accepted: statistics.opportunities_accepted,
        opportunities_rejected: statistics.opportunities_rejected,
      },
      output_file: outputFile,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
    });
  }

  emitError(code: string, message: string, phase: string, round: number | null, recoverable: boolean): void {
    this.emit({
      type: 'error',
      code,
      message,
      phase,
      round,
      recoverable,
      timestamp: new Date().toISOString(),
    });
  }

  emitCodexProgress(round: number, text: string, tokenCount: number | null, status?: string): void {
    this.emit({
      type: 'codex_progress',
      round,
      text,
      token_count: tokenCount,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  emitClaudeProgress(round: number, text: string, tokenCount: number): void {
    this.emit({
      type: 'claude_progress',
      round,
      text,
      token_count: tokenCount,
      timestamp: new Date().toISOString(),
    });
  }
}
