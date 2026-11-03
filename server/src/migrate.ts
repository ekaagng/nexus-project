import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.migrationDatabaseUrl) {
    throw new Error('MIGRATION_DATABASE_URL is required. Run migrations with the dedicated schema-owner role.');
  }

  const pool = new Pool({
    connectionString: config.migrationDatabaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined
  });
  const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');

  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS nexus_schema_migrations (
      migration_name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort();

    for (const name of migrations) {
      const exists = await pool.query('SELECT 1 FROM nexus_schema_migrations WHERE migration_name = $1', [name]);
      if (exists.rowCount) {
        process.stdout.write(`skip ${name} (already applied)\\n`);
        continue;
      }

      const sql = await readFile(join(migrationDirectory, name), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO nexus_schema_migrations (migration_name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        process.stdout.write(`applied ${name}\\n`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : 'unknown error'}\\n`);
  process.exitCode = 1;
});
