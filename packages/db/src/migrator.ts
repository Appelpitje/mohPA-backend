/**
 * CentralSpy Database Migration Runner
 */

import { DbClient } from './client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(client: DbClient): Promise<void> {
  if (!client.isPostgres()) {
    // In-memory client handles schema virtually
    return;
  }

  // Ensure migrations tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const executedRes = await client.query<{ name: string }>('SELECT name FROM _migrations');
  const executedSet = new Set(executedRes.rows.map(r => r.name));

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (executedSet.has(file)) {
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`[Migrator] Applying migration: ${file}...`);
    await client.transaction(async (tx) => {
      await tx.query(sql);
      await tx.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    });
    console.log(`[Migrator] Successfully applied ${file}`);
  }
}
