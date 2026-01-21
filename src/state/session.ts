import type { StorageAdapter } from './storage.js';
import type {
  SessionManifest,
  SessionStatus,
  RoundPhase,
  SessionStatistics,
  CodexReview,
  ClaudeResponse,
  CodexConsensus,
  RoundTimings,
} from '../types/index.js';

const MANIFEST_PATH = 'manifest.json';

export class SessionManager {
  private manifest: SessionManifest;

  constructor(
    private storage: StorageAdapter,
    private inputFile: string,
    private outputFile: string,
    private maxRounds: number
  ) {
    this.manifest = this.createInitialManifest();
  }

  private createInitialManifest(): SessionManifest {
    return {
      session_id: this.storage.getSessionId(),
      input_file: this.inputFile,
      output_file: this.outputFile,
      started_at: new Date().toISOString(),
      completed_at: null,
      status: 'in_progress',
      current_round: 1,
      current_phase: 'pending',
      max_rounds: this.maxRounds,
      statistics: {
        total_issues_raised: 0,
        issues_resolved: 0,
        issues_disputed: 0,
        critical_unresolved: 0,
        major_unresolved: 0,
        total_opportunities_raised: 0,
        opportunities_accepted: 0,
        opportunities_rejected: 0,
        consensus_reached: false,
      },
    };
  }

  async initialize(): Promise<void> {
    await this.storage.initSession(this.manifest.session_id);
    await this.saveManifest();
  }

  async loadExisting(): Promise<boolean> {
    const data = await this.storage.read(MANIFEST_PATH);
    if (!data) return false;

    try {
      this.manifest = JSON.parse(data);
      this.manifest.statistics = await this.computeStatistics();
      return true;
    } catch {
      return false;
    }
  }

  getManifest(): SessionManifest { return { ...this.manifest }; }
  getSessionId(): string { return this.manifest.session_id; }
  getSessionPath(): string { return this.storage.getSessionPath(); }
  getCurrentRound(): number { return this.manifest.current_round; }
  getCurrentPhase(): RoundPhase { return this.manifest.current_phase; }

  async startRound(round: number): Promise<void> {
    this.manifest.current_round = round;
    this.manifest.current_phase = 'pending';
    await this.saveManifest();
  }

  async setPhase(phase: RoundPhase): Promise<void> {
    this.manifest.current_phase = phase;
    await this.saveManifest();
  }

  async complete(status: SessionStatus): Promise<void> {
    this.manifest.status = status;
    this.manifest.completed_at = new Date().toISOString();
    this.manifest.statistics = await this.computeStatistics();
    await this.saveManifest();
  }

  async saveCodexReview(round: number, review: CodexReview): Promise<void> {
    await this.storage.write(`round-${round}/codex-review.json`, JSON.stringify(review, null, 2));
  }

  async loadCodexReview(round: number): Promise<CodexReview | null> {
    const data = await this.storage.read(`round-${round}/codex-review.json`);
    return data ? JSON.parse(data) : null;
  }

  async saveClaudeResponse(round: number, response: ClaudeResponse): Promise<void> {
    await this.storage.write(`round-${round}/claude-response.json`, JSON.stringify(response, null, 2));
  }

  async loadClaudeResponse(round: number): Promise<ClaudeResponse | null> {
    const data = await this.storage.read(`round-${round}/claude-response.json`);
    return data ? JSON.parse(data) : null;
  }

  async saveConsensusCheck(round: number, consensus: CodexConsensus): Promise<void> {
    await this.storage.write(`round-${round}/codex-consensus.json`, JSON.stringify(consensus, null, 2));
  }

  async loadConsensusCheck(round: number): Promise<CodexConsensus | null> {
    const data = await this.storage.read(`round-${round}/codex-consensus.json`);
    return data ? JSON.parse(data) : null;
  }

  async saveDocument(round: number, content: string): Promise<void> {
    await this.storage.write(`round-${round}/document-v${round}.md`, content);
  }

  async saveRoundTimings(round: number, timings: RoundTimings): Promise<void> {
    await this.storage.write(`round-${round}/timings.json`, JSON.stringify(timings, null, 2));
  }

  async loadDocument(round: number): Promise<string | null> {
    return this.storage.read(`round-${round}/document-v${round}.md`);
  }

  async saveFinalDocument(content: string): Promise<void> {
    await this.storage.write('final/document.md', content);
  }

  async saveFinalSummary(summary: object): Promise<void> {
    await this.storage.write('final/summary.json', JSON.stringify(summary, null, 2));
  }

  async findResumePoint(): Promise<{ round: number; phase: RoundPhase }> {
    const round = this.manifest.current_round;

    const hasCodexReview = await this.storage.exists(`round-${round}/codex-review.json`);
    const hasClaudeResponse = await this.storage.exists(`round-${round}/claude-response.json`);
    const hasDocument = await this.storage.exists(`round-${round}/document-v${round}.md`);

    if (hasDocument) return { round: round + 1, phase: 'pending' };
    if (hasClaudeResponse) return { round, phase: 'consensus_check' };
    if (hasCodexReview) return { round, phase: 'claude_response' };
    return { round, phase: 'codex_review' };
  }

  private async computeStatistics(): Promise<SessionStatistics> {
    const stats: SessionStatistics = {
      total_issues_raised: 0,
      issues_resolved: 0,
      issues_disputed: 0,
      critical_unresolved: 0,
      major_unresolved: 0,
      total_opportunities_raised: 0,
      opportunities_accepted: 0,
      opportunities_rejected: 0,
      consensus_reached: false,
    };

    for (let round = 1; round <= this.manifest.current_round; round++) {
      const review = await this.loadCodexReview(round);
      const response = await this.loadClaudeResponse(round);
      const consensus = await this.loadConsensusCheck(round);

      if (review) {
        stats.total_issues_raised += review.issues.length;
        stats.total_opportunities_raised += review.opportunities.length;
      }

      if (response) {
        for (const r of response.responses) {
          if (r.feedback_id.startsWith('opp-')) {
            if (r.verdict === 'agree') stats.opportunities_accepted++;
            else if (r.verdict === 'disagree') stats.opportunities_rejected++;
          } else if (!consensus && r.feedback_id.startsWith('issue-')) {
            if (r.verdict === 'agree') stats.issues_resolved++;
          }
        }
        if (response.consensus_assessment.reached) stats.consensus_reached = true;
      }

      if (consensus && review) {
        const severityById = new Map(review.issues.map(i => [i.id, i.severity]));
        for (const r of consensus.feedback_responses) {
          const severity = severityById.get(r.original_feedback_id);
          if (r.resolution_status === 'resolved' || r.resolution_status === 'validly_disputed') {
            stats.issues_resolved++;
          } else if (r.resolution_status === 'inadequate') {
            stats.issues_disputed++;
            if (severity === 'critical') stats.critical_unresolved++;
            if (severity === 'major') stats.major_unresolved++;
          }
        }

        if (consensus.new_issues.length > 0) {
          stats.total_issues_raised += consensus.new_issues.length;
          for (const issue of consensus.new_issues) {
            if (issue.severity === 'critical') stats.critical_unresolved++;
            if (issue.severity === 'major') stats.major_unresolved++;
          }
        }
      }
    }

    return stats;
  }

  private async saveManifest(): Promise<void> {
    await this.storage.write(MANIFEST_PATH, JSON.stringify(this.manifest, null, 2));
  }
}
