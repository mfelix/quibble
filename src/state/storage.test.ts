import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemoryStorageAdapter, FileStorageAdapter } from './storage.js';

describe('MemoryStorageAdapter', () => {
  it('stores and retrieves data', async () => {
    const adapter = new MemoryStorageAdapter('test-session');
    await adapter.write('test/file.txt', 'hello world');
    expect(await adapter.read('test/file.txt')).toBe('hello world');
  });

  it('returns null for non-existent paths', async () => {
    const adapter = new MemoryStorageAdapter();
    expect(await adapter.read('does/not/exist.txt')).toBeNull();
  });

  it('lists files in directory', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.write('round-1/codex-review.json', '{}');
    await adapter.write('round-1/claude-response.json', '{}');
    await adapter.write('round-2/codex-review.json', '{}');

    const round1Files = await adapter.list('round-1');
    expect(round1Files).toContain('codex-review.json');
    expect(round1Files).toContain('claude-response.json');
    expect(round1Files).not.toContain('round-2');
  });

  it('checks if file exists', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.write('existing.txt', 'content');
    expect(await adapter.exists('existing.txt')).toBe(true);
    expect(await adapter.exists('non-existing.txt')).toBe(false);
  });
});

describe('FileStorageAdapter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quibble-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes and reads files atomically', async () => {
    const adapter = new FileStorageAdapter(tempDir, 'test-session');
    await adapter.initSession('test-session');
    await adapter.write('test/file.txt', 'hello world');
    expect(await adapter.read('test/file.txt')).toBe('hello world');
  });

  it('creates nested directories', async () => {
    const adapter = new FileStorageAdapter(tempDir, 'test-session');
    await adapter.initSession('test-session');
    await adapter.write('deep/nested/path/file.txt', 'content');
    expect(await adapter.exists('deep/nested/path/file.txt')).toBe(true);
  });

  it('returns null for non-existent files', async () => {
    const adapter = new FileStorageAdapter(tempDir, 'test-session');
    await adapter.initSession('test-session');
    expect(await adapter.read('does-not-exist.txt')).toBeNull();
  });

  it('returns correct session path', async () => {
    const adapter = new FileStorageAdapter(tempDir, 'my-session-id');
    expect(adapter.getSessionPath()).toContain('sessions/my-session-id');
  });
});
