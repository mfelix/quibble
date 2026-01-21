import * as fs from 'node:fs';
import * as path from 'node:path';
import { findGitRoot } from '../utils/git.js';

export interface QuibbleConfig {
  inputFile: string;
  outputFile: string;
  maxRounds: number;
  contextMaxFiles?: number;
  contextMaxFileBytes?: number;
  contextMaxTotalBytes?: number;
  dryRun: boolean;
  jsonOutput: boolean;
  persist: boolean;
  debugClaude: boolean;
  debugCodex: boolean;
  keepDebug: boolean;
  resumeSessionId?: string;
  sessionDir: string;
}

interface RawOptions {
  maxRounds: string;
  output?: string;
  contextMaxFiles?: string;
  contextMaxFileBytes?: string;
  contextMaxTotalBytes?: string;
  dryRun: boolean;
  json: boolean;
  persist: boolean;
  debugClaude: boolean;
  debugCodex: boolean;
  keepDebug: boolean;
  resume?: string;
  sessionDir?: string;
}

export function resolveConfig(inputFile: string, options: RawOptions): QuibbleConfig {
  // Validate input file
  const absoluteInput = path.resolve(inputFile);

  if (!fs.existsSync(absoluteInput)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const stats = fs.statSync(absoluteInput);
  if (!stats.isFile()) {
    throw new Error(`Input path is not a file: ${inputFile}`);
  }

  // Check file size (max 1MB)
  const maxSize = 1024 * 1024;
  if (stats.size > maxSize) {
    throw new Error(`Input file too large: ${stats.size} bytes (max ${maxSize})`);
  }

  // Validate UTF-8 by attempting to read
  try {
    const content = fs.readFileSync(absoluteInput, 'utf-8');
    // Check for binary content (null bytes)
    if (content.includes('\0')) {
      throw new Error('Input file appears to be binary');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('binary')) {
      throw error;
    }
    throw new Error(`Cannot read input file as UTF-8: ${inputFile}`);
  }

  // Validate --resume and --no-persist are mutually exclusive
  if (options.resume && !options.persist) {
    throw new Error('Cannot use --resume with --no-persist');
  }

  // Parse max rounds
  const maxRounds = parseInt(options.maxRounds, 10);
  if (isNaN(maxRounds) || maxRounds < 1) {
    throw new Error('--max-rounds must be a positive integer');
  }

  const contextMaxFiles = parseOptionalPositiveInt(options.contextMaxFiles, '--context-max-files');
  const contextMaxFileBytes = parseOptionalPositiveInt(
    options.contextMaxFileBytes,
    '--context-max-file-bytes'
  );
  const contextMaxTotalBytes = parseOptionalPositiveInt(
    options.contextMaxTotalBytes,
    '--context-max-total-bytes'
  );

  // Resolve output file
  const outputFile = options.output ?? deriveOutputPath(absoluteInput);

  // Resolve session directory
  const sessionDir = resolveSessionDir(absoluteInput, options.sessionDir, options.persist);

  return {
    inputFile: absoluteInput,
    outputFile: path.resolve(outputFile),
    maxRounds,
    contextMaxFiles,
    contextMaxFileBytes,
    contextMaxTotalBytes,
    dryRun: options.dryRun,
    jsonOutput: options.json,
    persist: options.persist,
    debugClaude: options.debugClaude,
    debugCodex: options.debugCodex,
    keepDebug: options.keepDebug,
    resumeSessionId: options.resume,
    sessionDir,
  };
}

function deriveOutputPath(inputPath: string): string {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  return path.join(dir, `${base}-quibbled${ext}`);
}

function resolveSessionDir(inputFile: string, override?: string, persist?: boolean): string {
  if (!persist) {
    return ''; // No session dir needed for in-memory mode
  }

  if (override) {
    return path.resolve(override);
  }

  // Try git root first
  const gitRoot = findGitRoot(path.dirname(inputFile));
  if (gitRoot) {
    return path.join(gitRoot, '.quibble');
  }

  // Fall back to input file directory
  return path.join(path.dirname(inputFile), '.quibble');
}

function parseOptionalPositiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}
