import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exit } from 'node:process';

import type { BuiltinToolManifest } from '@lobechat/types';

import { MemoryManifest } from '../../builtin-tool-memory';

const OUTPUT_DIR = join(process.cwd(), 'promptfoo/tool-calls');

const writeToolCallSchemaFromManifest = async (prefix: string, manifest: BuiltinToolManifest) => {
  for (const tool of manifest.api) {
    const transformedTool = {
      ...tool,
      type: 'function',
    };
    await writeFile(
      join(OUTPUT_DIR, `${prefix}-${transformedTool.name}.json`),
      JSON.stringify(transformedTool, null, 2),
    );
  }
};

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeToolCallSchemaFromManifest('memory', MemoryManifest);
}

main().catch((err) => {
  console.error(err);
  exit(1);
});
