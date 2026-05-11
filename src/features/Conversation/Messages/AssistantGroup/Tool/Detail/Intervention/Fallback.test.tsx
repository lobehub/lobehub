/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import FallbackIntervention from './Fallback';

const metaMap: Record<string, { avatar?: string; title?: string }> = {
  'calculator': { title: 'Calculator' },
  'lobe-activator': { avatar: '🛠', title: 'Tools & Skills Activator' },
  'search': { title: 'Web Search' },
};

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
  Avatar: ({ avatar, title }: { avatar?: string; title?: string }) => (
    <img alt={title} src={avatar} />
  ),
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Icon: () => <span>icon</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) =>
      (
        ({
          'builtins.lobe-activator.apiName.activateTools': 'Activate Tools',
          'builtins.lobe-activator.title': 'Tools & Skills Activator',
          'edit': 'Edit',
        }) as Record<string, string>
      )[key] ||
      (key === 'tool.intervention.viewParameters'
        ? `View parameters (${options?.count ?? 0})`
        : options?.defaultValue || key),
  }),
}));

vi.mock('@/store/tool/selectors', () => ({
  toolSelectors: {
    getMetaById: (id: string) => () => metaMap[id],
  },
}));

vi.mock('@/store/tool', () => ({
  pluginHelpers: {
    getPluginTitle: (meta?: { title?: string }) => meta?.title,
  },
  useToolStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  toolInterventionSelectors: {
    approvalMode: () => 'manual',
  },
}));

vi.mock('../../../../../store', () => ({
  useConversationStore: (
    selector: (state: { updatePluginArguments: ReturnType<typeof vi.fn> }) => unknown,
  ) => selector({ updatePluginArguments: vi.fn() }),
}));

vi.mock('../Arguments', () => ({
  default: ({ arguments: args }: { arguments?: string }) => <pre>{args}</pre>,
}));

vi.mock('./ApprovalActions', () => ({
  default: () => <div>approval-actions</div>,
}));

vi.mock('./KeyValueEditor', () => ({
  default: () => <div>editor</div>,
}));

describe('FallbackIntervention', () => {
  it('shows requested tool names for activateTools interventions', () => {
    render(
      <FallbackIntervention
        apiName="activateTools"
        assistantGroupId="assistant-group-1"
        id="message-1"
        identifier="lobe-activator"
        requestArgs='{"identifiers":["search","calculator"]}'
        toolCallId="tool-call-1"
      />,
    );

    expect(
      screen.getByText('Tools & Skills Activator → Activate Tools (Web Search, Calculator)'),
    ).toBeInTheDocument();
  });

  it('shows the activation reason for activateTools interventions', () => {
    const reason = 'I need GTD tools to create and manage the requested task list.';

    render(
      <FallbackIntervention
        apiName="activateTools"
        assistantGroupId="assistant-group-1"
        id="message-1"
        identifier="lobe-activator"
        requestArgs={JSON.stringify({ identifiers: ['search'], reason })}
        toolCallId="tool-call-1"
      />,
    );

    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('renders URL avatars as images instead of visible text', () => {
    const iconUrl = 'https://example.com/icon.png';
    metaMap.search.avatar = iconUrl;

    render(
      <FallbackIntervention
        apiName="search"
        assistantGroupId="assistant-group-1"
        id="message-1"
        identifier="search"
        requestArgs="{}"
        toolCallId="tool-call-1"
      />,
    );

    expect(screen.queryByText(iconUrl)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Web Search' })).toHaveAttribute('src', iconUrl);
  });
});
