/**
 * Thread store — persists threads as one JSON file each under `data/threads/`.
 *
 * Deliberately the simplest thing that works: no Redis, no SQLite yet. A thread
 * is small, reads/writes are infrequent, and plain files are trivial to inspect
 * and debug. We can swap this implementation later behind the same methods.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Thread, ThreadEntry } from '../types.js';

export class ThreadStore {
  constructor(private readonly dir = join(process.cwd(), 'data', 'threads')) {}

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async create(title: string): Promise<Thread> {
    await mkdir(this.dir, { recursive: true });
    const now = Date.now();
    const thread: Thread = {
      id: randomUUID().slice(0, 8),
      title,
      entries: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.save(thread);
    return thread;
  }

  async get(id: string): Promise<Thread | undefined> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8')) as Thread;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<Thread[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const threads: Thread[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const thread = await this.get(file.slice(0, -'.json'.length));
      if (thread) threads.push(thread);
    }
    return threads.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async append(id: string, entry: ThreadEntry): Promise<Thread> {
    const thread = await this.get(id);
    if (!thread) throw new Error(`thread not found: ${id}`);
    thread.entries.push(entry);
    thread.updatedAt = Date.now();
    await this.save(thread);
    return thread;
  }

  private async save(thread: Thread): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(thread.id), JSON.stringify(thread, null, 2), 'utf8');
  }
}
