import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { v4 as uuidv4 } from 'uuid';

export interface StorageAdapter {
  initSession(sessionId: string): Promise<void>;
  write(sessionPath: string, data: string): Promise<void>;
  read(sessionPath: string): Promise<string | null>;
  exists(sessionPath: string): Promise<boolean>;
  list(sessionPath: string): Promise<string[]>;
  getSessionId(): string;
  getSessionPath(): string;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private data: Map<string, string> = new Map();
  private sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? uuidv4();
  }

  async initSession(_sessionId: string): Promise<void> {}

  async write(sessionPath: string, data: string): Promise<void> {
    this.data.set(sessionPath, data);
  }

  async read(sessionPath: string): Promise<string | null> {
    return this.data.get(sessionPath) ?? null;
  }

  async exists(sessionPath: string): Promise<boolean> {
    return this.data.has(sessionPath);
  }

  async list(sessionPath: string): Promise<string[]> {
    const prefix = sessionPath.endsWith('/') ? sessionPath : sessionPath + '/';
    const results: string[] = [];

    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        const relative = key.slice(prefix.length);
        const firstSlash = relative.indexOf('/');
        const entry = firstSlash === -1 ? relative : relative.slice(0, firstSlash);
        if (entry && !results.includes(entry)) {
          results.push(entry);
        }
      }
    }

    return results;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionPath(): string {
    return '[in-memory]';
  }
}

export class FileStorageAdapter implements StorageAdapter {
  private sessionId: string;
  private basePath: string;

  constructor(baseDir: string, sessionId?: string) {
    this.sessionId = sessionId ?? uuidv4();
    this.basePath = path.join(baseDir, 'sessions', this.sessionId);
  }

  async initSession(_sessionId: string): Promise<void> {
    await fs.promises.mkdir(this.basePath, { recursive: true });
  }

  async write(sessionPath: string, data: string): Promise<void> {
    const fullPath = path.join(this.basePath, sessionPath);
    const dir = path.dirname(fullPath);

    await fs.promises.mkdir(dir, { recursive: true });

    // Atomic write: write to temp file, then rename
    const tempPath = path.join(os.tmpdir(), `quibble-${uuidv4()}.tmp`);
    await fs.promises.writeFile(tempPath, data, 'utf-8');
    await fs.promises.rename(tempPath, fullPath);
  }

  async read(sessionPath: string): Promise<string | null> {
    const fullPath = path.join(this.basePath, sessionPath);

    try {
      return await fs.promises.readFile(fullPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async exists(sessionPath: string): Promise<boolean> {
    const fullPath = path.join(this.basePath, sessionPath);

    try {
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async list(sessionPath: string): Promise<string[]> {
    const fullPath = path.join(this.basePath, sessionPath);

    try {
      return await fs.promises.readdir(fullPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionPath(): string {
    return this.basePath;
  }
}

export function createStorageAdapter(
  persist: boolean,
  sessionDir: string,
  resumeSessionId?: string
): StorageAdapter {
  if (!persist) {
    return new MemoryStorageAdapter();
  }

  return new FileStorageAdapter(sessionDir, resumeSessionId);
}
