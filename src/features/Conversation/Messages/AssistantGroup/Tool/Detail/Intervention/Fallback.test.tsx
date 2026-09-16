/**
 * @vitest-environment happy-dom
 */
import type { BuiltinInterventionProps } from '@lobechat/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FallbackIntervention from './Fallback';
import Intervention from './index';

const { submitHeteroIntervention } = vi.hoisted(() => ({
  submitHeteroIntervention: vi.fn(),
}));

const metaMap: Record<string, { avatar?: string; title?: string }> = {
  'calculator': { title: 'Calculator' },
  'lobe-activator': { avatar: '🛠', title: 'Tools & Skills Activator' },
  'search': { title: 'Web Search' },
};

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

vi.mock('@lobechat/builtin-tools/interventions', () => ({
  getBuiltinIntervention: (identifier?: string, apiName?: string) => {
    if (identifier !== 'devin' || apiName !== 'askUserQuestion') return;

    return ({ onInteractionAction }: BuiltinInterventionProps) => (
      <button
        data-testid="devin-permission-option"
        type="button"
        onClick={() =>
          void onInteractionAction?.({
            payload: { 'Allow Devin to continue?': 'allow-once' },
            type: 'submit',
          })
        }
      >
        Allow once
      </button>
    );
  },
}));

vi.mock('../../../../../hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => ({ canUseResource: true }),
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
  dataSelectors: {
    getDbMessageById: () => () => undefined,
  },
  useConversationStore: (
    selector: (state: {
      cancelToolInteraction: ReturnType<typeof vi.fn>;
      skipToolInteraction: ReturnType<typeof vi.fn>;
      submitHeteroIntervention: typeof submitHeteroIntervention;
      submitToolInteraction: ReturnType<typeof vi.fn>;
      updatePluginArguments: ReturnType<typeof vi.fn>;
    }) => unknown,
  ) =>
    selector({
      cancelToolInteraction: vi.fn(),
      skipToolInteraction: vi.fn(),
      submitHeteroIntervention,
      submitToolInteraction: vi.fn(),
      updatePluginArguments: vi.fn(),
    }),
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
    const reason = 'I need lobe-agent tools to create and manage the requested task list.';

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

describe('heterogeneous custom intervention', () => {
  it('routes a Devin permission option ID through submitHeteroIntervention', async () => {
    render(
      <Intervention
        apiName="askUserQuestion"
        id="message-devin-permission"
        identifier="devin"
        requestArgs='{"questions":[{"question":"Allow Devin to continue?","options":[{"id":"allow-once","label":"Allow once"}]}]}'
        toolCallId="devin-permission-1"
      />,
    );

    fireEvent.click(screen.getByTestId('devin-permission-option'));

    await waitFor(() => {
      expect(submitHeteroIntervention).toHaveBeenCalledWith('message-devin-permission', 'submit', {
        'Allow Devin to continue?': 'allow-once',
      });
    });
  });
});
