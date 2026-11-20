import { sql } from 'drizzle-orm';

import { db } from './database';

export const list = (input: { sort: string }) => {
  // alint-expect
  return db.execute(sql.raw(`SELECT id FROM topics ORDER BY ${input.sort}`));
};
