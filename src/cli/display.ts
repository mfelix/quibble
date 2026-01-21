import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { QuibbleEvent } from '../types/index.js';
import { version } from './version.js';

export class Display {
  private labelWidth: number = 12;
  private spinner: Ora | null = null;
  private jsonMode: boolean;
  private verbose: boolean;
  private startTime: number = Date.now();
  private claudeProgressBuffer: string = '';
  private lastProgressUpdate: number = 0;
  private claudeStartTime: number | null = null;
  private claudeTimer: NodeJS.Timeout | null = null;
  private claudePreview: string = '';
  private claudeTokenCount: number = 0;
  private codexStartTime: number | null = null;
  private codexTimer: NodeJS.Timeout | null = null;
  private codexProgressBuffer: string = '';
  private codexPreview: string = '';
  private codexTokenCount: number | null = null;
  private codexStatus: string = '';
  private totalCodexMs: number = 0;
  private totalClaudeMs: number = 0;
  private totalConsensusMs: number = 0;
  private totalRoundMs: number = 0;
  private totalCodexTokens: number = 0;
  private totalClaudeTokens: number = 0;

  constructor(options: { jsonMode: boolean; verbose: boolean }) {
    this.jsonMode = options.jsonMode;
    this.verbose = options.verbose;
  }

  handleEvent(event: QuibbleEvent): void {
    if (this.jsonMode) {
      console.log(JSON.stringify(event));
      return;
    }

    switch (event.type) {
      case 'start':
        this.showHeader(event.input_file, event.output_file);
        break;
      case 'round_start':
        this.showRoundStart(event.round);
        break;
      case 'round_complete':
        this.showRoundComplete(event);
        break;
      case 'context':
        this.showContext(event);
        break;
      case 'codex_review':
        this.stopSpinner();
        this.showCodexReview(event);
        break;
      case 'codex_progress':
        this.showCodexProgress(event);
        break;
      case 'claude_progress':
        this.showClaudeProgress(event);
        break;
      case 'claude_response':
        this.claudeProgressBuffer = '';
        this.stopSpinner();
        this.showClaudeResponse(event);
        break;
      case 'consensus':
        this.stopSpinner();
        this.showConsensus(event);
        break;
      case 'complete':
        this.stopSpinner();
        this.showComplete(event);
        break;
      case 'error':
        this.stopSpinner();
        this.showError(event);
        break;
    }
  }

  private showClaudeProgress(event: QuibbleEvent & { type: 'claude_progress' }): void {
    this.claudeProgressBuffer += event.text;
    this.claudeTokenCount = event.token_count;

    // Throttle updates to every 100ms to avoid excessive terminal updates
    const now = Date.now();
    if (now - this.lastProgressUpdate < 100) {
      return;
    }
    this.lastProgressUpdate = now;

    // Show a truncated preview of the response with token count
    this.claudePreview = this.truncatePreview(this.claudeProgressBuffer, 60);
    this.updateClaudeSpinner();
  }

  private showCodexProgress(event: QuibbleEvent & { type: 'codex_progress' }): void {
    const prevTokenCount = this.codexTokenCount;
    this.codexProgressBuffer += event.text;
    this.codexTokenCount = event.token_count;
    if (event.status) {
      this.codexStatus = event.status;
    }

    const tokenChanged = prevTokenCount !== this.codexTokenCount;
    const hasText = Boolean(event.text);
    const hasStatus = Boolean(event.status);

    const now = Date.now();
    if (!tokenChanged && !hasText && !hasStatus && now - this.lastProgressUpdate < 100) {
      return;
    }
    this.lastProgressUpdate = now;

    this.codexPreview = this.truncatePreview(this.codexProgressBuffer, 60);
    this.updateCodexSpinner();
  }

  private truncatePreview(text: string, maxLength: number): string {
    // Clean up the text: replace newlines with spaces, collapse whitespace
    const cleaned = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

    // Take the last portion of the text to show recent progress
    if (cleaned.length <= maxLength) {
      return cleaned;
    }

    return '...' + cleaned.slice(-maxLength);
  }

  startSpinner(text: string): void {
    if (this.jsonMode) return;
    this.spinner = ora(text).start();
  }

  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
    if (this.claudeTimer) {
      clearInterval(this.claudeTimer);
      this.claudeTimer = null;
    }
    if (this.codexTimer) {
      clearInterval(this.codexTimer);
      this.codexTimer = null;
    }
  }

  private showHeader(inputFile: string, outputFile: string): void {
    console.log();
  }

  private showRoundStart(round: number): void {
    console.log(chalk.bold(`Round ${round}`));
    console.log(chalk.gray('-'.repeat(7)));
    this.startCodexSpinner();
  }

  private showCodexReview(event: QuibbleEvent & { type: 'codex_review' }): void {
    const critical = event.issues.filter(i => i.severity === 'critical').length;
    const major = event.issues.filter(i => i.severity === 'major').length;
    const minor = event.issues.filter(i => i.severity === 'minor').length;
    const high = event.opportunities.filter(o => o.impact === 'high').length;
    const medium = event.opportunities.filter(o => o.impact === 'medium').length;

    console.log(
      chalk.yellow(
        `${this.formatLabel('Codex')} Found ${event.issues.length} issues (${critical} critical, ${major} major, ${minor} minor)`
      )
    );
    console.log(
      chalk.yellow(
        `${this.formatLabel('Codex')} Found ${event.opportunities.length} opportunities (${high} high, ${medium} medium)`
      )
    );
    this.showStepUsage('Codex', this.codexStartTime, this.codexTokenCount);
    console.log();
    this.startClaudeSpinner();
  }

  private showContext(event: QuibbleEvent & { type: 'context' }): void {
    if (!this.verbose) return;

    const totalKb = Math.ceil(event.total_bytes / 1024);
    const fileList = event.files.map((file) => {
      const suffix = file.truncated ? ' (truncated)' : '';
      return `${file.path}${suffix}`;
    });
    const shown = fileList.slice(0, 6);
    const remaining = fileList.length - shown.length;
    const line = remaining > 0
      ? `${shown.join(', ')} (+${remaining} more)`
      : shown.join(', ');

    console.log(chalk.gray(`${this.formatLabel('Context')} Included ${event.files.length} files (${totalKb} KB)`));
    if (line) {
      console.log(chalk.gray(`${this.formatLabel('Context')} ${line}`));
    }
    console.log();
  }

  private showClaudeResponse(event: QuibbleEvent & { type: 'claude_response' }): void {
    console.log(
      chalk.blue(`${this.formatLabel('Claude')} Agreed: ${event.agreed.length} issues, disputed: ${event.disputed.length}`)
    );
    if (event.partial.length > 0) {
      console.log(chalk.blue(`${this.formatLabel('Claude')} Partial agreement: ${event.partial.length} items`));
    }
    console.log(chalk.blue(`${this.formatLabel('Claude')} Document updated`));
    this.showStepUsage('Claude', this.claudeStartTime, this.claudeTokenCount);
    console.log();
    this.startSpinner(chalk.magenta('[Consensus] Checking...'));
  }

  private startClaudeSpinner(): void {
    this.claudeStartTime = Date.now();
    this.claudePreview = '';
    this.claudeTokenCount = 0;
    this.startSpinner(chalk.blue('[Claude] Analyzing feedback...'));
    this.updateClaudeSpinner();
    this.claudeTimer = setInterval(() => {
      this.updateClaudeSpinner();
    }, 1000);
  }

  private startCodexSpinner(): void {
    this.codexStartTime = Date.now();
    this.codexProgressBuffer = '';
    this.codexPreview = '';
    this.codexTokenCount = null;
    this.codexStatus = 'reviewing';
    this.startSpinner(chalk.yellow('[Codex] Reviewing document...'));
    this.updateCodexSpinner();
    this.codexTimer = setInterval(() => {
      this.updateCodexSpinner();
    }, 1000);
  }

  private updateCodexSpinner(): void {
    if (!this.spinner) return;
    const elapsed = this.codexStartTime ? Math.floor((Date.now() - this.codexStartTime) / 1000) : 0;
    const elapsedStr = `${elapsed}s`;
    const status = this.codexStatus ? ` ${this.codexStatus}` : '';
    this.spinner.text = chalk.yellow(`[Codex ${elapsedStr}] Reviewing document...${status}`);
  }

  private updateClaudeSpinner(): void {
    if (!this.spinner) return;
    const elapsed = this.claudeStartTime ? Math.floor((Date.now() - this.claudeStartTime) / 1000) : 0;
    const elapsedStr = `${elapsed}s`;
    const tokenStr = this.claudeTokenCount.toLocaleString();
    const preview = this.claudePreview ? ` "${this.claudePreview}"` : '';
    this.spinner.text = chalk.blue(`[Claude ${elapsedStr}] ${tokenStr} tokens${preview}`);
  }

  private showConsensus(event: QuibbleEvent & { type: 'consensus' }): void {
    if (event.reached) {
      console.log(chalk.green(`${this.formatLabel('Consensus')} Reached!`));
    } else {
      console.log(
        chalk.yellow(`${this.formatLabel('Consensus')} Not reached - ${event.outstanding.length} items outstanding`)
      );
    }
  }

  private showRoundComplete(event: QuibbleEvent & { type: 'round_complete' }): void {
    const timings = event.timings;
    const parts: string[] = [];

    const consensusParts: string[] = [];
    if (typeof timings.codex_consensus_tokens === 'number') {
      consensusParts.push(`${timings.codex_consensus_tokens.toLocaleString()} tokens`);
    }
    if (typeof timings.consensus_check_ms === 'number') {
      consensusParts.push(this.formatDuration(timings.consensus_check_ms));
    }
    if (consensusParts.length > 0) {
      console.log(chalk.gray(`${this.formatLabel('Usage')} Codex: ${consensusParts.join(' | ')}`));
    }

    console.log(chalk.gray(`${this.formatLabel('Round')} Total: ${this.formatDuration(timings.round_total_ms)}`));
    console.log();

    this.totalCodexMs += timings.codex_review_ms ?? 0;
    this.totalClaudeMs += timings.claude_response_ms ?? 0;
    this.totalConsensusMs += timings.consensus_check_ms ?? 0;
    this.totalRoundMs += timings.round_total_ms;
    if (typeof timings.codex_total_tokens === 'number') {
      this.totalCodexTokens += timings.codex_total_tokens;
    }
    if (typeof timings.claude_total_tokens === 'number') {
      this.totalClaudeTokens += timings.claude_total_tokens;
    }
  }

  private showComplete(event: QuibbleEvent & { type: 'complete' }): void {
    const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    console.log(chalk.gray('='.repeat(47)));
    console.log();
    console.log(`${this.formatLabel('Summary')} Rounds: ${event.total_rounds}`);
    console.log(
      `${this.formatLabel('Summary')} Issues resolved: ${event.statistics.issues_resolved}/${event.statistics.total_issues_raised}`
    );
    console.log(
      `${this.formatLabel('Summary')} Opportunities accepted: ${event.statistics.opportunities_accepted}/${event.statistics.total_opportunities_raised}`
    );

    const sessionParts: string[] = [];
    if (this.totalCodexMs > 0) {
      sessionParts.push(`Codex ${this.formatDuration(this.totalCodexMs)}`);
    }
    if (this.totalClaudeMs > 0) {
      sessionParts.push(`Claude ${this.formatDuration(this.totalClaudeMs)}`);
    }
    if (this.totalConsensusMs > 0) {
      sessionParts.push(`Consensus ${this.formatDuration(this.totalConsensusMs)}`);
    }
    if (sessionParts.length > 0) {
      const sessionTotal = this.formatDuration(this.totalRoundMs);
      console.log(`${this.formatLabel('Summary')} Session total: ${sessionTotal}`);
    } else {
      console.log(`${this.formatLabel('Summary')} Time elapsed: ${timeStr}`);
    }

    const sessionUsage: string[] = [];
    if (this.totalCodexTokens > 0) {
      sessionUsage.push(`Codex ${this.totalCodexTokens.toLocaleString()}`);
    }
    if (this.totalClaudeTokens > 0) {
      sessionUsage.push(`Claude ${this.totalClaudeTokens.toLocaleString()}`);
    }
    if (sessionUsage.length > 0) {
      console.log(`${this.formatLabel('Summary')} Session usage: ${sessionUsage.join(' | ')}`);
    }

    console.log();
    console.log(`Output written to: ${chalk.cyan(event.output_file)}`);
    console.log(`Session saved to: ${chalk.gray(event.session_id)}`);
    console.log();

    if (event.status === 'max_rounds_reached_unsafe') {
      console.log(chalk.red('Warning: Critical issues remain unresolved'));
    } else if (event.status === 'max_rounds_reached_warning') {
      console.log(chalk.yellow('Warning: Major issues remain unresolved'));
    }
  }

  private formatDuration(durationMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  private showStepUsage(
    label: string,
    startTime: number | null,
    tokenCount: number | null
  ): void {
    const elapsedMs = startTime ? Date.now() - startTime : null;
    const parts: string[] = [];
    if (typeof tokenCount === 'number') {
      parts.push(`${tokenCount.toLocaleString()} tokens`);
    }
    if (elapsedMs !== null) {
      parts.push(this.formatDuration(elapsedMs));
    }
    if (parts.length > 0) {
      console.log(chalk.gray(`${this.formatLabel('Usage')} ${label}: ${parts.join(' | ')}`));
    }
  }

  private formatLabel(label: string): string {
    return `[${label}]`.padEnd(this.labelWidth, ' ');
  }

  private showError(event: QuibbleEvent & { type: 'error' }): void {
    console.log();
    console.log(chalk.red(`Error [${event.code}]: ${event.message}`));
    if (event.phase) {
      console.log(chalk.gray(`Phase: ${event.phase}, Round: ${event.round ?? 'N/A'}`));
    }
    if (event.recoverable) {
      console.log(chalk.yellow('This error may be recoverable. Try resuming the session.'));
    }
  }
}
