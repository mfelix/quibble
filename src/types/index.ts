import { z } from 'zod';

// ============================================================
// Codex Review Types (Phase 1)
// ============================================================

export const IssueSchema = z.object({
  id: z.string(),
  severity: z.enum(['critical', 'major', 'minor']),
  section: z.string(),
  description: z.string(),
  suggestion: z.string().optional(),
});

export const OpportunitySchema = z.object({
  id: z.string(),
  impact: z.enum(['high', 'medium', 'low']),
  section: z.string(),
  description: z.string(),
  suggestion: z.string().optional(),
});

export const CodexReviewSchema = z.object({
  issues: z.array(IssueSchema),
  opportunities: z.array(OpportunitySchema),
  overall_assessment: z.string(),
});

export type Issue = z.infer<typeof IssueSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;
export type CodexReview = z.infer<typeof CodexReviewSchema>;

// ============================================================
// Claude Response Types (Phase 2)
// ============================================================

export const FeedbackResponseSchema = z.object({
  feedback_id: z.string(),
  verdict: z.enum(['agree', 'disagree', 'partial']),
  reasoning: z.string(),
  action_taken: z.string(),
});

export const ConsensusAssessmentSchema = z.object({
  reached: z.boolean(),
  outstanding_disagreements: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});

export const ClaudeResponseSchema = z.object({
  responses: z.array(FeedbackResponseSchema),
  updated_document: z.string(),
  consensus_assessment: ConsensusAssessmentSchema,
});

export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
export type ConsensusAssessment = z.infer<typeof ConsensusAssessmentSchema>;
export type ClaudeResponse = z.infer<typeof ClaudeResponseSchema>;

// ============================================================
// Codex Consensus Types (Phase 3)
// ============================================================

export const ResolutionStatusSchema = z.enum([
  'resolved',
  'inadequate',
  'validly_disputed',
  'new_issues',
]);

export const FeedbackResolutionSchema = z.object({
  original_feedback_id: z.string(),
  resolution_status: ResolutionStatusSchema,
  comment: z.string(),
});

export const CodexConsensusSchema = z.object({
  verdict: z.enum(['approve', 'reject']),
  feedback_responses: z.array(FeedbackResolutionSchema),
  new_issues: z.array(IssueSchema),
  summary: z.string(),
});

export type ResolutionStatus = z.infer<typeof ResolutionStatusSchema>;
export type FeedbackResolution = z.infer<typeof FeedbackResolutionSchema>;
export type CodexConsensus = z.infer<typeof CodexConsensusSchema>;

export const SummaryItemSchema = z.object({
  id: z.string(),
  summary: z.string(),
});

export const SummariesSchema = z.object({
  summaries: z.array(SummaryItemSchema),
});

export type SummaryItem = z.infer<typeof SummaryItemSchema>;
export type Summaries = z.infer<typeof SummariesSchema>;

// ============================================================
// Session & State Types
// ============================================================

export type SessionStatus =
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'max_rounds_reached'
  | 'max_rounds_reached_warning'
  | 'max_rounds_reached_unsafe';

export type RoundPhase =
  | 'pending'
  | 'codex_review'
  | 'claude_response'
  | 'consensus_check'
  | 'complete';

export interface SessionStatistics {
  total_issues_raised: number;
  issues_resolved: number;
  issues_disputed: number;
  critical_unresolved: number;
  major_unresolved: number;
  total_opportunities_raised: number;
  opportunities_accepted: number;
  opportunities_rejected: number;
  consensus_reached: boolean;
}

export interface SessionManifest {
  session_id: string;
  input_file: string;
  output_file: string;
  started_at: string;
  completed_at: string | null;
  status: SessionStatus;
  current_round: number;
  current_phase: RoundPhase;
  max_rounds: number;
  statistics: SessionStatistics;
}

// ============================================================
// JSONL Event Types (for --json output)
// ============================================================

export interface StartEvent {
  type: 'start';
  session_id: string;
  input_file: string;
  output_file: string;
  max_rounds: number;
  timestamp: string;
}

export interface RoundStartEvent {
  type: 'round_start';
  round: number;
  timestamp: string;
}

export interface RoundTimings {
  codex_review_ms?: number;
  claude_response_ms?: number;
  consensus_check_ms?: number;
  codex_review_tokens?: number;
  claude_response_tokens?: number;
  claude_response_tokens_estimated?: boolean;
  codex_consensus_tokens?: number;
  codex_total_tokens?: number;
  claude_total_tokens?: number;
  round_total_ms: number;
  session_elapsed_ms: number;
}

export interface RoundCompleteEvent {
  type: 'round_complete';
  round: number;
  timings: RoundTimings;
  timestamp: string;
}

export interface ContextEvent {
  type: 'context';
  round: number;
  files: Array<{ path: string; bytes: number; truncated: boolean }>;
  total_bytes: number;
  timestamp: string;
}

export interface RoundItemsEvent {
  type: 'round_items';
  round: number;
  issues: Array<{
    id: string;
    severity: 'critical' | 'major' | 'minor';
    description: string;
    verdict: 'agree' | 'disagree' | 'partial' | 'unknown';
  }>;
  opportunities: Array<{
    id: string;
    impact: 'high' | 'medium' | 'low';
    description: string;
    verdict: 'agree' | 'disagree' | 'partial' | 'unknown';
  }>;
  timestamp: string;
}

export interface CodexReviewEvent {
  type: 'codex_review';
  round: number;
  issues: Array<{ id: string; severity: 'critical' | 'major' | 'minor' }>;
  opportunities: Array<{ id: string; impact: 'high' | 'medium' | 'low' }>;
  timestamp: string;
}

export interface ClaudeResponseEvent {
  type: 'claude_response';
  round: number;
  agreed: string[];
  disputed: string[];
  partial: string[];
  timestamp: string;
}

export interface ConsensusEvent {
  type: 'consensus';
  round: number;
  reached: boolean;
  outstanding: string[];
  timestamp: string;
}

export interface CompleteEvent {
  type: 'complete';
  status: 'completed' | 'max_rounds_reached' | 'max_rounds_reached_warning' | 'max_rounds_reached_unsafe';
  exit_code: 0 | 1 | 2;
  total_rounds: number;
  statistics: {
    total_issues_raised: number;
    issues_resolved: number;
    issues_disputed: number;
    critical_unresolved: number;
    major_unresolved: number;
    total_opportunities_raised: number;
    opportunities_accepted: number;
    opportunities_rejected: number;
  };
  output_file: string;
  session_id: string;
  timestamp: string;
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  phase: string;
  round: number | null;
  recoverable: boolean;
  timestamp: string;
}

export interface ClaudeProgressEvent {
  type: 'claude_progress';
  round: number;
  text: string;
  token_count: number;
  token_estimated?: boolean;
  timestamp: string;
}

export interface CodexProgressEvent {
  type: 'codex_progress';
  round: number;
  text: string;
  token_count: number | null;
  status?: string;
  timestamp: string;
}

export type QuibbleEvent =
  | StartEvent
  | RoundStartEvent
  | RoundCompleteEvent
  | ContextEvent
  | RoundItemsEvent
  | CodexReviewEvent
  | ClaudeResponseEvent
  | ConsensusEvent
  | CompleteEvent
  | ErrorEvent
  | ClaudeProgressEvent
  | CodexProgressEvent;
