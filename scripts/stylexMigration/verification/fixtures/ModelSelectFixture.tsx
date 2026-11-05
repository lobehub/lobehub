import { useLayoutEffect, useRef } from 'react';
import { ModelSelect } from 'verification:component';

import { FixtureI18n } from './FixtureI18n';

const values: Record<string, { model: string; provider: string }> = {
  normal: { model: 'gpt-4o', provider: 'openai' },
  redirected: { model: 'retired-model', provider: 'openai' },
  stale: { model: 'legacy-model', provider: 'openai' },
};

export const Fixture = ({ variant }: { variant: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [state, kind] = variant.split('-');
  useLayoutEffect(() => {
    if (state === 'open') ref.current?.querySelector<HTMLElement>('[role="combobox"]')?.click();
  }, [state]);
  return (
    <FixtureI18n>
      <div ref={ref}>
        <ModelSelect value={values[kind]} />
      </div>
    </FixtureI18n>
  );
};
