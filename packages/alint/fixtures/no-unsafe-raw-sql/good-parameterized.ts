import { sql } from 'drizzle-orm';

import { db } from './database';

export const search = (input: { title: string }) =>
  db.execute(sql`SELECT id FROM topics WHERE title = ${input.title}`);
