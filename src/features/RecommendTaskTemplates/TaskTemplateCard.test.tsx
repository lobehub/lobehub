import type { RecommendedTaskTemplate } from '@lobechat/const';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillConnectionResult, UseSkillConnectionResult } from './useSkillConnection';

const mocks = vi.hoisted(() => ({
  analyticsEnabled: true,
  analyticsTrack: vi.fn(() => Promise.resolve()),
  createCronJob: vi.fn(),
  errorMessage: vi.fn(),
  inboxAgentId: 'inbox-agent-1' as string | undefined,
  intersectionCallback: undefined as IntersectionObserverCallback | undefined,
  optionalConnectOptions: undefined as
    | { onConnectResult?: (result: SkillConnectionResult) => void }
    | undefined,
  optionalConnection: undefined as UseSkillConnectionResult | undefined,
  recordCreated: vi.fn(),
  requiredConnectOptions: undefined as
    | { onConnectResult?: (result: SkillConnectionResult) => void }
    | undefined,
  requiredConnection: undefined as UseSkillConnectionResult | undefined,
  successMessage: vi.fn(),
  userId: 'user-1' as string | undefined,
}));

vi.mock('antd-style', () => {
  const cssVar = {
    borderRadiusLG: '8px',
    borderRadiusSM: '4px',
    colorBorder: '#ddd',
    colorFillSecondary: '#f5f5f5',
    colorPrimary: '#1677ff',
    colorText: '#111',
    colorTextSecondary: '#666',
    colorTextTertiary: '#999',
  };

  return {
    createStaticStyles: (factory: (helpers: { css: () => string; cssVar: typeof cssVar }) => any) =>
      factory({ css: () => 'mock-class', cssVar }),
    cssVar,
    cx: (...classes: Array<string | undefined>) => classes.filter(Boolean).join(' '),
  };
});

vi.mock('@lobehub/ui', () => {
  const Div = ({ children, ...props }: any) => <div {...props}>{children}</div>;

  return {
    ActionIcon: ({ icon: _icon, title, ...props }: any) => (
      <button aria-label={typeof title === 'string' ? title : undefined} type="button" {...props}>
        {typeof title === 'string' ? title : 'icon'}
      </button>
    ),
    Block: ({ children, ref, ...props }: any) => (
      <div ref={ref} {...props}>
        {children}
      </div>
    ),
    Button: ({ children, loading, ...props }: any) => (
      <button disabled={props.disabled || loading} type="button" {...props}>
        {children}
      </button>
    ),
    Center: Div,
    Flexbox: Div,
    Icon: () => <span data-testid="icon" />,
    Tag: Div,
    Text: Div,
  };
});

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: mocks.errorMessage,
        success: mocks.successMessage,
      },
    }),
  },
  Divider: () => <hr />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const translations: Record<string, string> = {
        'action.connect.button': `Connect ${options?.provider}`,
        'action.connect.error': 'Connect failed',
        'action.connect.popupBlocked': 'Popup blocked',
        'action.create.error': 'Create failed',
        'action.create.success': 'Created',
        'action.createButton': 'Create',
        'action.creating': 'Creating',
        'action.dismiss.tooltip': 'Not interested',
        'action.optionalConnect.button': `Connect ${options?.provider}`,
        'card.templateTag': 'Template',
        'schedule.daily': 'Daily',
        'template-a.description': 'Template description',
        'template-a.prompt': 'Template prompt',
        'template-a.title': 'Template A',
      };

      return translations[key] ?? key;
    },
  }),
}));

vi.mock('@/features/DailyBrief/BriefCardSummary', () => ({
  default: ({ summary }: { summary: string }) => <div>{summary}</div>,
}));

vi.mock('@/services/agentCronJob', () => ({
  agentCronJobService: {
    create: mocks.createCronJob,
  },
}));

vi.mock('@/services/taskTemplate', () => ({
  taskTemplateService: {
    recordCreated: mocks.recordCreated,
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
}));

vi.mock('@/store/agent/selectors', () => ({
  builtinAgentSelectors: {
    inboxAgentId: () => mocks.inboxAgentId,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: { user?: { id?: string } }) => unknown) =>
    selector({ user: { id: mocks.userId } }),
}));

vi.mock('@lobehub/analytics/react', () => ({
  useAnalytics: () => ({
    analytics: mocks.analyticsEnabled
      ? {
          track: mocks.analyticsTrack,
        }
      : undefined,
  }),
}));

vi.mock('./useSkillConnection', () => {
  class SkillConnectionPopupBlockedError extends Error {
    constructor() {
      super('Browser popup blocked');
      this.name = 'SkillConnectionPopupBlockedError';
    }
  }

  return {
    SkillConnectionPopupBlockedError,
    useSkillConnection: (
      specs: Array<{ provider: string; source: 'klavis' | 'lobehub' }> | undefined,
      options?: { onConnectResult?: (result: SkillConnectionResult) => void },
    ) => {
      const provider = specs?.[0]?.provider;
      if (provider === 'github') {
        mocks.requiredConnectOptions = options;
        return mocks.requiredConnection!;
      }
      if (provider === 'notion') {
        mocks.optionalConnectOptions = options;
        return mocks.optionalConnection!;
      }

      return {
        connect: vi.fn(),
        isAllConnected: false,
        isConnecting: false,
        needsConnect: false,
        nextUnconnected: undefined,
      };
    },
  };
});

const { TaskTemplateCard } = await import('./TaskTemplateCard');

const makeConnection = (
  overrides: Partial<UseSkillConnectionResult> = {},
): UseSkillConnectionResult => ({
  connect: vi.fn(),
  isAllConnected: false,
  isConnecting: false,
  needsConnect: false,
  nextUnconnected: undefined,
  ...overrides,
});

const makeTemplate = (
  overrides: Partial<RecommendedTaskTemplate> = {},
): RecommendedTaskTemplate => ({
  category: 'engineering',
  cronPattern: '0 9 * * *',
  id: 'template-a',
  interests: ['coding'],
  source: 'matched',
  ...overrides,
});

const renderCard = (template = makeTemplate()) => {
  const onCreated = vi.fn();
  const onDismiss = vi.fn();

  render(
    <TaskTemplateCard
      position={0}
      recommendationBatchId="batch-1"
      template={template}
      userInterestCount={1}
      onCreated={onCreated}
      onDismiss={onDismiss}
    />,
  );

  return { onCreated, onDismiss };
};

const triggerIntersection = () => {
  mocks.intersectionCallback?.(
    [{ isIntersecting: true } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mocks.analyticsEnabled = true;
  mocks.inboxAgentId = 'inbox-agent-1';
  mocks.intersectionCallback = undefined;
  mocks.userId = 'user-1';
  mocks.requiredConnection = makeConnection();
  mocks.optionalConnection = makeConnection();
  mocks.requiredConnectOptions = undefined;
  mocks.optionalConnectOptions = undefined;
  mocks.createCronJob.mockResolvedValue({ id: 'cron-1' });
  mocks.recordCreated.mockResolvedValue({ success: true });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        mocks.intersectionCallback = callback;
      }
      disconnect = vi.fn();
      observe = vi.fn();
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TaskTemplateCard analytics', () => {
  it('does not mark an impression as tracked before analytics is ready', () => {
    mocks.analyticsEnabled = false;
    const { rerender } = render(
      <TaskTemplateCard
        position={0}
        recommendationBatchId="batch-1"
        template={makeTemplate()}
        userInterestCount={1}
        onCreated={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(mocks.intersectionCallback).toBeUndefined();
    expect(
      Object.keys(sessionStorage).some((key) => key.startsWith('task-template-impression:')),
    ).toBe(false);

    mocks.analyticsEnabled = true;
    rerender(
      <TaskTemplateCard
        position={0}
        recommendationBatchId="batch-1"
        template={makeTemplate()}
        userInterestCount={1}
        onCreated={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    triggerIntersection();

    expect(mocks.analyticsTrack).toHaveBeenCalledWith({
      name: 'task_template_card_impression',
      properties: expect.objectContaining({
        spm: 'home.task_templates.card_impression',
        template_id: 'template-a',
      }),
    });
  });

  it('tracks a card impression once per session storage key', () => {
    renderCard();

    triggerIntersection();
    triggerIntersection();

    expect(mocks.analyticsTrack).toHaveBeenCalledTimes(1);
    expect(mocks.analyticsTrack).toHaveBeenCalledWith({
      name: 'task_template_card_impression',
      properties: expect.objectContaining({
        position: 0,
        primary_action: 'create',
        recommendation_batch_id: 'batch-1',
        source: 'matched',
        spm: 'home.task_templates.card_impression',
        template_id: 'template-a',
        user_interest_count: 1,
      }),
    });
  });

  it('tracks create success and removes the created template from the current list', async () => {
    const user = userEvent.setup();
    const { onCreated } = renderCard();

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mocks.createCronJob).toHaveBeenCalled());
    expect(mocks.analyticsTrack).toHaveBeenCalledWith({
      name: 'task_template_create_clicked',
      properties: expect.objectContaining({
        spm: 'home.task_templates.create_clicked',
        template_id: 'template-a',
      }),
    });
    expect(mocks.analyticsTrack).toHaveBeenCalledWith({
      name: 'task_template_create_result',
      properties: expect.objectContaining({
        error_type: null,
        result: 'success',
        spm: 'home.task_templates.create_result',
      }),
    });
    expect(onCreated).toHaveBeenCalledWith('template-a');
  });

  it('tracks create failure without removing the template', async () => {
    const user = userEvent.setup();
    const { onCreated } = renderCard();
    mocks.createCronJob.mockRejectedValueOnce(new Error('network'));

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mocks.analyticsTrack).toHaveBeenCalledWith({
        name: 'task_template_create_result',
        properties: expect.objectContaining({
          error_type: 'Error',
          result: 'fail',
          spm: 'home.task_templates.create_result',
        }),
      }),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('tracks dismiss with impression timing state', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderCard();
    triggerIntersection();

    await user.click(screen.getByRole('button', { name: 'Not interested' }));

    expect(mocks.analyticsTrack).toHaveBeenCalledWith({
      name: 'task_template_dismissed',
      properties: expect.objectContaining({
        spm: 'home.task_templates.dismissed',
        template_id: 'template-a',
        was_impressed: true,
      }),
    });
    expect(onDismiss).toHaveBeenCalledWith('template-a');
  });

  it('tracks required skill connect clicked and result events', async () => {
    const user = userEvent.setup();
    const connect = vi.fn(async () => {
      mocks.requiredConnectOptions?.onConnectResult?.({
        durationMs: 123,
        provider: 'github',
        result: 'success',
        source: 'lobehub',
      });
    });
    mocks.requiredConnection = makeConnection({
      connect,
      needsConnect: true,
      nextUnconnected: {
        icon: 'github',
        label: 'GitHub',
        provider: 'github',
        source: 'lobehub',
      },
    });

    renderCard(
      makeTemplate({
        requiresSkills: [{ provider: 'github', source: 'lobehub' }],
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));

    expect(mocks.analyticsTrack).toHaveBeenCalledWith({
      name: 'task_template_skill_connect_clicked',
      properties: expect.objectContaining({
        requirement_type: 'required',
        skill_provider: 'github',
        skill_source: 'lobehub',
        spm: 'home.task_templates.skill_connect_clicked',
      }),
    });
    expect(mocks.analyticsTrack).toHaveBeenCalledWith({
      name: 'task_template_skill_connect_result',
      properties: expect.objectContaining({
        duration_ms: 123,
        requirement_type: 'required',
        result: 'success',
        skill_provider: 'github',
        skill_source: 'lobehub',
        spm: 'home.task_templates.skill_connect_result',
      }),
    });
  });
});
