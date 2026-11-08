import { sql } from 'drizzle-orm';

import { db } from './database';

export const list = (input: { sort: string }) => {
  if (input.sort !== 'title' && input.sort !== 'created_at') throw new Error('Invalid sort');
  return db.execute(sql.raw(`SELECT id FROM topics ORDER BY ${input.sort}`));
};
