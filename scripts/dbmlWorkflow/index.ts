import { join } from 'node:path';

import { pgGenerate } from 'drizzle-dbml-generator';

import * as schema from '../../packages/database/src/schemas';

const out = join(__dirname, '../../docs/development/database-schema.dbml');
const relational = true;

pgGenerate({ out, relational, schema });

console.log('🏁 dbml generated successful!');
