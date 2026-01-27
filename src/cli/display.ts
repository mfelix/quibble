import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import type { QuibbleEvent } from '../types/index.js';

export class Display {
  private labelWidth: number = 12;
  private spinner: Ora | null = null;
  private jsonMode: boolean;
  private startTime: number = Date.now();
  private claudeProgressBuffer: string = '';
  private lastProgressUpdate: number = 0;
  private claudeStartTime: number | null = null;
  private claudeTimer: NodeJS.Timeout | null = null;
  private claudePreview: string = '';
  private claudeTokenCount: number = 0;
  private claudeTokenEstimated: boolean = false;
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

  constructor(options: { jsonMode: boolean }) {
    this.jsonMode = options.jsonMode;
  }

  handleEvent(event: QuibbleEvent): void {
    if (this.jsonMode) {
      console.log(JSON.stringify(event));
      return;
    }

    switch (event.type) {
      case 'start':
        this.showHeader(event);
        break;
      case 'round_start':
        this.showRoundStart(event.round);
        break;
      case 'round_complete':
        this.showRoundComplete(event);
        break;
      case 'round_items':
        this.showRoundItems(event);
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
    if (this.claudeStartTime === null) {
      this.stopSpinner();
      this.startClaudeSpinner();
    }
    this.claudeProgressBuffer += event.text;
    this.claudeTokenCount = event.token_count;
    this.claudeTokenEstimated = event.token_estimated ?? false;

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

  private showHeader(event: QuibbleEvent & { type: 'start' }): void {
    console.log();
    console.log(chalk.gray(`${this.formatLabel('Session')} ${event.session_id}`));
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

    // Show summary box
    this.showSummaryBox('Summary', event.overall_assessment);
    console.log();

    // Show issues table
    const allLevels = event.issues
      .map(issue => this.formatLevel(issue.severity))
      .concat(event.opportunities.map(opp => this.formatLevel(opp.impact)));
    const levelWidth = Math.max(4, ...allLevels.map(level => level.length));

    if (event.issues.length > 0) {
      console.log(chalk.gray('Issues'));
      this.printCodexItemsTable(
        event.issues
          .slice()
          .sort((a, b) => this.compareSeverity(a.severity, b.severity))
          .map((issue) => ({
            level: this.formatLevel(issue.severity),
            description: issue.description,
          })),
        levelWidth
      );
      console.log();
    }

    if (event.opportunities.length > 0) {
      console.log(chalk.gray('Opportunities'));
      this.printCodexItemsTable(
        event.opportunities
          .slice()
          .sort((a, b) => this.compareImpact(a.impact, b.impact))
          .map((opp) => ({
            level: this.formatLevel(opp.impact),
            description: opp.description,
          })),
        levelWidth
      );
      console.log();
    }

    this.startClaudeSpinner();
  }

  private showContext(event: QuibbleEvent & { type: 'context' }): void {
    const hadSpinner = Boolean(this.spinner);
    if (this.spinner) {
      this.spinner.stop();
    }

    const totalKb = Math.ceil(event.total_bytes / 1024);
    console.log(chalk.gray(`${this.formatLabel('Context')} Included ${event.files.length} files (${totalKb} KB)`));

    for (const file of event.files) {
      const suffix = file.truncated ? chalk.yellow(' (truncated)') : '';
      console.log(chalk.gray(`${this.formatLabel('Context')}   ${file.path}${suffix}`));
    }
    console.log();

    if (this.spinner && hadSpinner) {
      this.spinner.start();
    }
  }

  private showClaudeResponse(event: QuibbleEvent & { type: 'claude_response' }): void {
    console.log(
      chalk.blue(`${this.formatLabel('Claude')} Agreed: ${event.agreed.length} issues, disputed: ${event.disputed.length}`)
    );
    if (event.partial.length > 0) {
      console.log(chalk.blue(`${this.formatLabel('Claude')} Partial agreement: ${event.partial.length} items`));
    }
    console.log(chalk.blue(`${this.formatLabel('Claude')} Document updated`));
    this.showStepUsage('Claude', this.claudeStartTime, this.claudeTokenCount, this.claudeTokenEstimated);
    console.log();

    // Show summary box
    this.showSummaryBox('Summary', event.consensus_summary);
    console.log();
  }

  private startClaudeSpinner(): void {
    this.claudeStartTime = Date.now();
    this.claudePreview = '';
    this.claudeTokenCount = 0;
    this.claudeTokenEstimated = false;
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
      console.log(chalk.gray(`${this.formatLabel('Usage')} Codex: ${consensusParts.join(' · ')}`));
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

  private showRoundItems(event: QuibbleEvent & { type: 'round_items' }): void {
    this.stopSpinner();
    const allLevels = event.issues
      .map(issue => this.formatLevel(issue.severity))
      .concat(event.opportunities.map(opp => this.formatLevel(opp.impact)));
    const levelWidth = Math.max(4, ...allLevels.map(level => level.length));

    if (event.issues.length > 0) {
      console.log(chalk.gray('Issues'));
      this.printItemsTable(
        event.issues
          .slice()
          .sort((a, b) => this.compareSeverity(a.severity, b.severity))
          .map((issue) => ({
            level: this.formatLevel(issue.severity),
            verdict: issue.verdict,
            description: issue.description,
          })),
        levelWidth
      );
      console.log();
    }

    if (event.opportunities.length > 0) {
      console.log(chalk.gray('Opportunities'));
      this.printItemsTable(
        event.opportunities
          .slice()
          .sort((a, b) => this.compareImpact(a.impact, b.impact))
          .map((opp) => ({
            level: this.formatLevel(opp.impact),
            verdict: opp.verdict,
            description: opp.description,
          })),
        levelWidth
      );
      console.log();
    }

    this.startSpinner(chalk.magenta('[Consensus] Checking...'));
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
      console.log(`${this.formatLabel('Summary')} Session usage: ${sessionUsage.join(' · ')}`);
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
    tokenCount: number | null,
    estimated?: boolean
  ): void {
    const elapsedMs = startTime ? Date.now() - startTime : null;
    const parts: string[] = [];
    if (typeof tokenCount === 'number') {
      const suffix = estimated ? '~' : '';
      parts.push(`${tokenCount.toLocaleString()} tokens${suffix}`);
    }
    if (elapsedMs !== null) {
      parts.push(this.formatDuration(elapsedMs));
    }
    if (parts.length > 0) {
      console.log(chalk.gray(`${this.formatLabel('Usage')} ${label}: ${parts.join(' · ')}`));
    }
  }

  private formatLabel(label: string): string {
    return `[${label}]`.padEnd(this.labelWidth, ' ');
  }

  private printItemsTable(items: Array<{
    level: string;
    verdict: 'agree' | 'disagree' | 'partial' | 'unknown';
    description: string;
  }>, levelWidth: number): void {
    const numberWidth = Math.max(1, items.length.toString().length);
    const gap = '  ';

    let index = 1;
    for (const item of items) {
      const verdict = this.formatVerdict(item.verdict);
      const description = this.truncateDescription(item.description, 64);
      const number = `#${String(index).padStart(numberWidth)}`;
      const row = `${number}${gap}${item.level.padEnd(levelWidth)}    ${verdict} ${description}`;
      console.log(row);
      index++;
    }
  }

  private formatVerdict(verdict: 'agree' | 'disagree' | 'partial' | 'unknown'): string {
    switch (verdict) {
      case 'agree':
        return '✓';
      case 'disagree':
        return '✗';
      case 'partial':
        return '~';
      default:
        return '?';
    }
  }

  private formatLevel(level: 'critical' | 'major' | 'minor' | 'high' | 'medium' | 'low'): string {
    switch (level) {
      case 'critical':
        return 'crit';
      case 'major':
        return 'major';
      case 'minor':
        return 'minor';
      case 'high':
        return 'high';
      case 'medium':
        return 'med';
      case 'low':
        return 'low';
      default:
        return level;
    }
  }

  private compareSeverity(
    left: 'critical' | 'major' | 'minor',
    right: 'critical' | 'major' | 'minor'
  ): number {
    const order = { critical: 0, major: 1, minor: 2 } as const;
    return order[left] - order[right];
  }

  private compareImpact(
    left: 'high' | 'medium' | 'low',
    right: 'high' | 'medium' | 'low'
  ): number {
    const order = { high: 0, medium: 1, low: 2 } as const;
    return order[left] - order[right];
  }

  private truncateDescription(text: string, maxLength: number): string {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength - 3) + '...';
  }

  private showSummaryBox(title: string, text: string): void {
    const totalWidth = 76; // Total box width including corners
    const contentWidth = totalWidth - 4; // 72 chars for text between "│ " and " │"

    // Wrap text to fit within the box
    const lines = this.wrapText(text, contentWidth);

    // Draw the box
    const titlePart = `─ ${title} `;
    const topDashes = totalWidth - 2 - titlePart.length; // -2 for ┌ and ┐
    const topBorder = `┌${titlePart}${'─'.repeat(topDashes)}┐`;
    const bottomBorder = `└${'─'.repeat(totalWidth - 2)}┘`;

    console.log(topBorder);
    for (const line of lines) {
      const paddedLine = line.padEnd(contentWidth);
      console.log(`│ ${paddedLine} │`);
    }
    console.log(bottomBorder);
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length === 0) {
        currentLine = word;
      } else if (currentLine.length + 1 + word.length <= maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [''];
  }

  private printCodexItemsTable(items: Array<{
    level: string;
    description: string;
  }>, levelWidth: number): void {
    const numberWidth = Math.max(1, items.length.toString().length);
    const gap = '  ';

    let index = 1;
    for (const item of items) {
      const description = this.truncateDescription(item.description, 64);
      const number = `#${String(index).padStart(numberWidth)}`;
      const row = `${number}${gap}${item.level.padEnd(levelWidth)}    ${description}`;
      console.log(row);
      index++;
    }
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
