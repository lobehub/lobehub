import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScriptDiff } from './VersionDiff';

const codeDiff = vi.fn((_props: Record<string, unknown>) => null);

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CodeDiff: (props: Record<string, unknown>) => codeDiff(props),
}));

const version = (patch: Record<string, unknown>) =>
  ({
    id: 'v',
    manifest: null,
    outputType: 'stat',
    runtime: 'node',
    script: 'a\nb\nc\nd\ne\nf\ng\n',
    view: null,
    ...patch,
  }) as any;

describe('ScriptDiff', () => {
  it('expands unchanged lines so the untranslatable collapsed-lines label never renders', () => {
    render(
      <ScriptDiff
        base={version({ id: 'v1' })}
        target={version({
          id: 'v2',
          manifest: { timeoutMs: 1000 },
          script: 'a\nb\nc\nX\ne\nf\ng\n',
        })}
      />,
    );

    // Script diff and contract diff.
    expect(codeDiff).toHaveBeenCalledTimes(2);
    for (const [props] of codeDiff.mock.calls) {
      expect(props.diffOptions).toMatchObject({ expandUnchanged: true });
    }
  });
});
