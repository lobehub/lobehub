/**
 * @vitest-environment happy-dom
 */
import { AccordionRoot } from '@lobehub/ui/base-ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GroupItem from './GroupItem';

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) => selector({ activeAgentId: 'agent-1' }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    currentAgentMeta: () => ({ title: '验收合并-Alpha', avatar: '🅰️' }),
    getAgentMetaById: () => () => ({}),
  },
}));

// Capture what the group hands each row: by-agent buckets are named in the
// group header, so rows must not render a second leading agent avatar.
vi.mock('../../List/Item', () => ({
  default: (props: { suppressAgentAvatar?: boolean; title: string }) => (
    <div data-suppress={props.suppressAgentAvatar ? 'yes' : 'no'}>{props.title}</div>
  ),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('TopicByAgentGroupItem', () => {
  /** @example Review feedback: rows under an agent-named bucket must not repeat the avatar. */
  it('suppresses the row leading agent avatar because the group header already identifies the agent', () => {
    // ROOT CAUSE: the by-agent grouping named every bucket after its agent,
    // but each row still rendered the same avatar at its leading position —
    // the same identity twice in one row.
    render(
      <AccordionRoot defaultValue={['agent:agt_acc_merge_alpha']}>
        <GroupItem
          expanded
          group={{
            children: [{ createdAt: 1, id: 't1', title: 'A1-目录A任务', updatedAt: 1 }],
            id: 'agent:agt_acc_merge_alpha',
            title: '验收合并-Alpha',
          }}
        />
      </AccordionRoot>,
    );

    expect(screen.getByText('A1-目录A任务').getAttribute('data-suppress')).toBe('yes');
  });
});
