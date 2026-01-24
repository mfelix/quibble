import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { resolveConfig, type QuibbleConfig } from './config.js';
import { Display } from './display.js';
import { version } from './version.js';
import { createStorageAdapter } from '../state/storage.js';
import { SessionManager } from '../state/session.js';
import { EventEmitter } from '../core/events.js';
import { Orchestrator } from '../core/orchestrator.js';

export function run(argv: string[]): void {
  const program = new Command();

  program
    .name('quibble')
    .description('Adversarial AI document review CLI')
    .version(version)
    .argument('<file>', 'Path to markdown file to review')
    .option('--max-rounds <n>', 'Maximum review cycles before forced stop', '5')
    .option('--context-max-files <n>', 'Max auto-included context files')
    .option('--context-max-file-bytes <n>', 'Max bytes per context file')
    .option('--context-max-total-bytes <n>', 'Max total bytes across context files')
    .option('--output <path>', 'Output path for final document')
    .option('--no-summarize-items', 'Disable LLM summarization of issues/opportunities')
    .option('--dry-run', 'Show what would happen without executing', false)
    .option('--json', 'Output structured JSON for CI/automation', false)
    .option('--no-persist', 'Disable session storage; runs in-memory only')
    .option('--debug-claude', 'Log raw Claude stream lines for debugging', false)
    .option('--debug-codex', 'Log raw Codex stream lines for debugging', false)
    .option('--keep-debug', 'Keep debug logs after a successful run', false)
    .option('--resume <id>', 'Resume a previous session by ID')
    .option('--session-dir <path>', 'Override session storage location')
    .action(async (file: string, options: RawCliOptions) => {
      try {
        const config = resolveConfig(file, options);

        if (options.dryRun) {
          console.log('Dry run mode - would execute with config:');
          console.log(JSON.stringify(config, null, 2));
          return;
        }

        const exitCode = await execute(config);
        process.exit(exitCode);
      } catch (error) {
        if (options.json) {
          console.log(
            JSON.stringify({
              type: 'error',
              code: 'INIT_ERROR',
              message: error instanceof Error ? error.message : String(error),
              phase: 'initialization',
              round: null,
              recoverable: false,
              timestamp: new Date().toISOString(),
            })
          );
        } else {
          console.error('Error:', error instanceof Error ? error.message : error);
        }
        process.exit(1);
      }
    });

  program.parse(argv);
}

async function execute(config: QuibbleConfig): Promise<number> {
  const display = new Display({
    jsonMode: config.jsonOutput,
  });

  const events = new EventEmitter();
  events.subscribe((event) => display.handleEvent(event));

  const storage = createStorageAdapter(
    config.persist,
    config.sessionDir,
    config.inputFile,
    config.resumeSessionId
  );

  const session = new SessionManager(
    storage,
    config.inputFile,
    config.outputFile,
    config.maxRounds
  );

  if (config.resumeSessionId) {
    const loaded = await session.loadExisting();
    if (!loaded) {
      throw new Error(`Session not found: ${config.resumeSessionId}`);
    }
  } else {
    await session.initialize();
  }

  try {
    let debugDir: string | undefined;
    if (config.debugClaude || config.debugCodex) {
      const sessionPath = session.getSessionPath();
      debugDir = sessionPath === '[in-memory]'
        ? path.join(os.tmpdir(), `quibble-debug-${session.getSessionId()}`)
        : path.join(sessionPath, 'debug');
      await fs.promises.mkdir(debugDir, { recursive: true });
    }

    const orchestrator = new Orchestrator(config, session, events, {
      debugClaudeDir: config.debugClaude ? debugDir : undefined,
      debugCodexDir: config.debugCodex ? debugDir : undefined,
      keepDebug: config.keepDebug,
    });
    const result = await orchestrator.run();
    return result.exitCode;
  } catch (error) {
    events.emitError(
      'ORCHESTRATION_ERROR',
      error instanceof Error ? error.message : String(error),
      'orchestration',
      session.getCurrentRound(),
      true
    );
    return 2;
  }
}

interface RawCliOptions {
  maxRounds: string;
  output?: string;
  contextMaxFiles?: string;
  contextMaxFileBytes?: string;
  contextMaxTotalBytes?: string;
  summarizeItems: boolean;
  dryRun: boolean;
  json: boolean;
  persist: boolean;  // Note: Commander inverts --no-persist to persist: false
  debugClaude: boolean;
  debugCodex: boolean;
  keepDebug: boolean;
  resume?: string;
  sessionDir?: string;
}
