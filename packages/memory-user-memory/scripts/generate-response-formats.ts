/* eslint-disable unicorn/prefer-top-level-await */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exit } from 'node:process';

import { ContextMemorySchema, IdentityActionsSchema, PreferenceMemorySchema, ExperienceMemorySchema } from '../src/schemas';
import { buildGenerateObjectSchema } from '../src/utils/zod';

const OUTPUT_DIR = join(process.cwd(), 'promptfoo/response-formats');

const writeSchema = async (name: string, schema: any, description: string) => {
  const generateSchema = buildGenerateObjectSchema(schema, { description, name });

  const responseFormat = {
    json_schema: generateSchema.schema,
    type: 'json_schema' as const,
  };

  const outPath = join(OUTPUT_DIR, `${name}.json`);
  await writeFile(outPath, JSON.stringify(responseFormat, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath}`);
};

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  await writeSchema('identity', IdentityActionsSchema, 'Identity layer actions');
  await writeSchema('context', ContextMemorySchema, 'Context layer actions');
  await writeSchema('preference', PreferenceMemorySchema, 'Preference layer memories');
  await writeSchema('experience', ExperienceMemorySchema, 'Experience layer memories');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  exit(1);
});

