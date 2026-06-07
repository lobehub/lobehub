// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

const read = (filePath: string) => readFileSync(path.join(root, filePath), 'utf8');

describe('agent signal prompt boundaries', () => {
  /**
   * @example
   * Memory writer delegates model-facing prompt words to @lobechat/prompts.
   */
  it('keeps memory writer prompt words out of user memory action service', () => {
    const source = read(
      'src/server/services/agentSignal/policies/analyzeIntent/actions/userMemory.ts',
    );

    expect(source).not.toContain('const MEMORY_WRITER_SYSTEM_ROLE');
    expect(source).not.toContain('const toMemoryWriterPrompt');
    expect(source).toContain('createAgentSignalMemoryWriterPrompt');
  });
});
