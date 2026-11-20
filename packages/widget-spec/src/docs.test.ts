import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { widgetVersionContentSchema } from './index';

const docsDir = path.resolve(import.meta.dirname, '../../../docs/development');

/** The first ```json block under the doc's "Example" heading. */
const exampleDraft = (file: string) => {
  const text = readFileSync(path.join(docsDir, file), 'utf8');
  const section = text.slice(text.search(/^## (?:Example|示例)/m));
  const block = /```json\n([\S\s]*?)\n```/.exec(section);
  if (!block) throw new Error(`${file} has no example draft`);
  return JSON.parse(block[1]);
};

describe('development docs', () => {
  it.each(['widget-spec.mdx', 'widget-spec.zh-CN.mdx'])('%s example is a valid draft', (file) => {
    const result = widgetVersionContentSchema.safeParse(exampleDraft(file));
    expect(result.error?.issues).toBeUndefined();
  });

  it('shows the same example in both languages', () => {
    expect(exampleDraft('widget-spec.zh-CN.mdx')).toEqual(exampleDraft('widget-spec.mdx'));
  });
});
