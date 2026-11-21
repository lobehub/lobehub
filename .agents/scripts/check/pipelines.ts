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
      ['remark', '--silent', '--silently-ignore', '--output', '--'],
      ['prettier', '--write'],
    ],
  },
  {
    exts: ['.mdx'],
    tools: [['remark', '-r', './.remarkrc.mdx.mjs', '--silent', '--output', '--']],
  },
  { exts: ['.json'], tools: [['prettier', '--write']] },
  {
    exts: ['.mjs', '.cjs'],
    tools: [
      ['oxlint', '--fix', '--no-error-on-unmatched-pattern'],
      ['prettier', '--write'],
    ],
  },
  {
    exts: ['.js', '.jsx'],
    tools: [
      ['oxlint', '--fix', '--no-error-on-unmatched-pattern'],
      ['prettier', '--write'],
    ],
  },
  {
    // .mts/.cts are outside lint-staged's globs but belong to the same pipeline
    exts: ['.ts', '.tsx', '.mts', '.cts'],
    tools: [
      ['oxlint', '--fix', '--no-error-on-unmatched-pattern'],
      ['prettier', '--write'],
    ],
  },
  {
    exts: ['.css', '.less'],
    tools: [
      ['stylelint', '--fix'],
      ['prettier', '--write'],
    ],
  },
];
