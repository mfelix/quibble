import * as fs from 'node:fs';
import * as path from 'node:path';

export function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);

  while (current !== path.dirname(current)) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return current;
    }
    current = path.dirname(current);
  }

  return null;
}
