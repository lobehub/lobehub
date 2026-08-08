import type { PipelineEntry } from './types';

/**
 * This repo's extension → tool pipeline, mirroring the lint-staged config in
 * `package.json`. A drift test in `check.test.ts` keeps them in sync.
 * Superprojects that mount this repo import this table for the mount and
 * provide their own table for their root.
 */
export const lobehubPipelines: PipelineEntry[] = [
  {
    exts: ['.md'],
    tools: [
      ['remark', '--silent', '--output', '--'],
      ['prettier', '--write'],
    ],
  },
  {
    exts: ['.mdx'],
    tools: [
      ['remark', '-r', './.remarkrc.mdx.mjs', '--silent', '--output', '--'],
      ['eslint', '--quiet', '--fix'],
    ],
  },
  { exts: ['.json'], tools: [['prettier', '--write']] },
  {
    exts: ['.mjs', '.cjs'],
    tools: [
      ['eslint', '--fix'],
      ['prettier', '--write'],
    ],
  },
  {
    exts: ['.js', '.jsx'],
    tools: [
      ['eslint', '--fix'],
      ['stylelint', '--fix'],
      ['prettier', '--write'],
    ],
  },
  {
    // .mts/.cts are outside lint-staged's globs but belong to the same pipeline
    exts: ['.ts', '.tsx', '.mts', '.cts'],
    tools: [
      ['stylelint', '--fix'],
      ['eslint', '--fix'],
      ['prettier', '--write'],
    ],
  },
  { exts: ['.yml', '.yaml'], tools: [['eslint', '--fix']] },
];
