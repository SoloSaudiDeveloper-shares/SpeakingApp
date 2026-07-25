import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabase, db } from '../src/lib/db/index';

if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is required.');

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[migrate] PostgreSQL migrations applied.');
} finally {
  await closeDatabase();
}
