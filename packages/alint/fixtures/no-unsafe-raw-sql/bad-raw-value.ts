import { sql } from 'drizzle-orm';

import { db } from './database';

export const search = (input: { title: string }) => {
  // alint-expect
  return db.execute(sql.raw(`SELECT id FROM topics WHERE title = '${input.title}'`));
};
