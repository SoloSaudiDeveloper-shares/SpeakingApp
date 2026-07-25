import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, ssl: { rejectUnauthorized: true } });
try {
  await migrate(drizzle(pool), { migrationsFolder: '/app/drizzle' });
  console.log('[migration-job] Migrations applied.');
} finally {
  await pool.end();
}
