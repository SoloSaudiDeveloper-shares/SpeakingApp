import { seedDatabase } from '../src/lib/db/seed.ts';
import { closeDatabase } from '../src/lib/db/index.ts';

try {
  await seedDatabase();
} finally {
  await closeDatabase();
}
