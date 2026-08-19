import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

/**
 * Сколько места занимает каталог.
 *
 * Ошибки глотаются: нет папки — значит, файлов не загружали, это не повод
 * ронять сводку или список проектов.
 */
async function walk(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? await walk(full) : (await stat(full)).size;
  }
  return total;
}

export const projectFolderSize = (projectId: string): Promise<number> =>
  walk(join(UPLOAD_DIR, projectId));

export const totalUploadsSize = (): Promise<number> => walk(UPLOAD_DIR);

export const uploadsDir = UPLOAD_DIR;
