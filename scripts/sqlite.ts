import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Local D1-compatible surface, intentionally limited to the SQL API we use.
export function localDatabase(path = ':memory:') {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  const version = sqlite.prepare('PRAGMA user_version').get() as { user_version: number };
  if (version.user_version === 0) {
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
      sqlite.exec('PRAGMA user_version = 1; COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } else if (version.user_version !== 1) throw new Error('Unsupported local schema version');
  function prepare(sql: string, values: (string | number | null)[] = []): unknown {
    return {
      bind(...args: (string | number | null)[]) { return prepare(sql, args); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values), success: true }; },
      async run() { return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; }
    };
  }
  return { db: { prepare } as D1Database, close: () => sqlite.close() };
}

