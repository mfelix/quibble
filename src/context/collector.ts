import * as fs from 'node:fs';
import * as path from 'node:path';
import { findGitRoot } from '../utils/git.js';

export interface ContextOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
  bytes: number;
}

export interface ContextResult {
  block: string;
  files: ContextFile[];
  totalBytes: number;
}

const DEFAULT_MAX_FILES = 12;
const DEFAULT_MAX_FILE_BYTES = 40 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 120 * 1024;
const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.quibble',
]);

export async function buildContext(
  documentContent: string,
  inputFile: string,
  options: ContextOptions = {}
): Promise<ContextResult | null> {
  const baseDir = path.dirname(inputFile);
  const repoRoot = findGitRoot(baseDir) ?? baseDir;
  const { files, totalBytes } = await collectContextFiles(
    documentContent,
    repoRoot,
    baseDir,
    options
  );

  if (files.length === 0) return null;

  const lines: string[] = [];
  lines.push('The following files were auto-included based on references in the document.');
  lines.push('Use them as supporting context and do not speculate about unseen code.');

  for (const file of files) {
    const truncatedAttr = file.truncated ? 'true' : 'false';
    lines.push(`<file path="${file.path}" truncated="${truncatedAttr}">`);
    lines.push(file.content);
    lines.push('</file>');
  }

  return {
    block: `<repo_context>\n${lines.join('\n')}\n</repo_context>`,
    files,
    totalBytes,
  };
}

async function collectContextFiles(
  documentContent: string,
  repoRoot: string,
  baseDir: string,
  options: ContextOptions
): Promise<{ files: ContextFile[]; totalBytes: number }> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

  const candidates = extractReferences(documentContent);
  const resolved = resolveReferences(candidates, repoRoot, baseDir);

  const results: ContextFile[] = [];
  let totalBytes = 0;

  for (const absPath of resolved) {
    if (results.length >= maxFiles) break;
    if (totalBytes >= maxTotalBytes) break;

    const relPath = path.relative(repoRoot, absPath).split(path.sep).join('/');
    if (shouldIgnore(relPath)) continue;

    let content: string;
    try {
      content = await fs.promises.readFile(absPath, 'utf-8');
    } catch {
      continue;
    }

    if (content.includes('\0')) continue;

    let bytes = Buffer.byteLength(content, 'utf-8');
    let truncated = false;

    if (bytes > maxFileBytes) {
      content = content.slice(0, maxFileBytes);
      bytes = Buffer.byteLength(content, 'utf-8');
      truncated = true;
    }

    const remaining = maxTotalBytes - totalBytes;
    if (bytes > remaining) {
      content = content.slice(0, remaining);
      bytes = Buffer.byteLength(content, 'utf-8');
      truncated = true;
    }

    if (!content.trim()) continue;

    totalBytes += bytes;
    results.push({
      path: relPath,
      content: content.trimEnd(),
      truncated,
      bytes,
    });
  }

  return { files: results, totalBytes };
}

function extractReferences(documentContent: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  const linkRegex = /\[[^\]]+\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(documentContent)) !== null) {
    const normalized = normalizeReference(match[1]);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      refs.push(normalized);
    }
  }

  const pathRegex = /(^|[\s"'`(])([A-Za-z0-9_./-]+?\.[A-Za-z0-9]{1,8})(?=[$\s)"',.:;!?])/g;
  while ((match = pathRegex.exec(documentContent)) !== null) {
    const normalized = normalizeReference(match[2]);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      refs.push(normalized);
    }
  }

  return refs;
}

function normalizeReference(reference: string): string | null {
  let ref = reference.trim();
  if (!ref) return null;

  ref = ref.replace(/^[('"`<]+/, '').replace(/[)"'>,;.!]+$/, '');

  if (/^(https?:|mailto:)/i.test(ref)) return null;

  const hashIndex = ref.indexOf('#');
  if (hashIndex >= 0) ref = ref.slice(0, hashIndex);

  ref = ref.replace(/:\d+(:\d+)?$/, '');

  if (!ref.includes('.')) return null;
  if (ref === '.' || ref === '..') return null;

  return ref;
}

function resolveReferences(
  references: string[],
  repoRoot: string,
  baseDir: string
): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const ref of references) {
    const candidates: string[] = [];
    if (path.isAbsolute(ref)) {
      candidates.push(ref);
    } else {
      candidates.push(path.resolve(baseDir, ref));
      if (repoRoot !== baseDir) {
        candidates.push(path.resolve(repoRoot, ref));
      }
    }

    for (const candidate of candidates) {
      const normalized = path.normalize(candidate);
      if (seen.has(normalized)) continue;
      if (!isWithinRoot(normalized, repoRoot)) continue;

      let stats: fs.Stats;
      try {
        stats = fs.statSync(normalized);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;

      seen.add(normalized);
      resolved.push(normalized);
      break;
    }
  }

  return resolved;
}

function isWithinRoot(candidate: string, repoRoot: string): boolean {
  const relative = path.relative(repoRoot, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function shouldIgnore(relativePath: string): boolean {
  const parts = relativePath.split('/');
  for (const part of parts) {
    if (DEFAULT_IGNORED_DIRS.has(part)) {
      return true;
    }
  }
  return false;
}
