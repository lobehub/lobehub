import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { RuleGroup } from '@/services/expertise';

import { sectionsByOwner } from './labels';
import PartSwitcher from './PartSwitcher';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const agentGroup = (agentId: string, lessons: number) =>
  ({
    domain: { id: `d-${agentId}` },
    owner: {
      agent: { avatar: null, backgroundColor: null, id: agentId, title: agentId },
      kind: 'agent',
    },
    rules: Array.from({ length: lessons }, (_, index) => ({
      id: `${agentId}-${index}`,
      status: 'active',
    })),
    scopes: [],
  }) as unknown as RuleGroup;

describe('PartSwitcher', () => {
  // `few` comes first in server order (what onboarding opens), `many` leads by count.
  const sections = sectionsByOwner([agentGroup('few', 1), agentGroup('many', 5)]);

  it('reopens an agent opened from outside the switcher, not the count leader', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PartSwitcher sections={sections} value={'agent:few'} onChange={onChange} />,
    );
    rerender(<PartSwitcher sections={sections} value={'mine'} onChange={onChange} />);

    fireEvent.click(screen.getByText('rules.owner.agents'));

    expect(onChange).toHaveBeenLastCalledWith('agent:few');
  });

  it('opens the agent that learned the most when none was viewed yet', () => {
    const onChange = vi.fn();
    render(<PartSwitcher sections={sections} value={'mine'} onChange={onChange} />);

    fireEvent.click(screen.getByText('rules.owner.agents'));

    expect(onChange).toHaveBeenLastCalledWith('agent:many');
  });
});
