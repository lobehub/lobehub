import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateAgentModal } from './useCreateModal';

const analyticsTrack = vi.hoisted(() => vi.fn());
const telemetryState = vi.hoisted(() => ({ enabled: true }));
const marketApiMocks = vi.hoisted(() => ({
  searchSkill: vi.fn(),
}));
const skillServiceMocks = vi.hoisted(() => ({
  importFromMarket: vi.fn(),
}));
const toolStoreMocks = vi.hoisted(() => ({
  refreshAgentSkills: vi.fn(),
}));
const chatInputState = vi.hoisted(() => {
  interface Editor {
    focus: () => void;
    instance: {
      setDocument: (format: string, content: string) => void;
    };
  }

  interface State {
    editor: Editor;
    onMarkdownContentChange?: (content: string) => void;
    onSend?: () => void;
  }

  const state: State = {
    editor: {
      focus: vi.fn(),
      instance: {
        setDocument: vi.fn((_format: string, content: string) => {
          state.onMarkdownContentChange?.(content);
        }),
      },
    },
  };

  return state;
});

vi.mock('@lobehub/analytics', () => ({
  getSingletonAnalyticsOptional: () => ({
    getStatus: () => ({ initialized: true, providersCount: 1 }),
    track: analyticsTrack,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick }: { onClick?: () => void }) => (
    <button aria-label="icon action" type="button" onClick={onClick} />
  ),
  Block: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Button: ({
    children,
    disabled,
    loading,
    onClick,
    type,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    loading?: boolean;
    onClick?: () => void;
    type?: string;
  }) => (
    <button
      data-button-loading={loading ? 'true' : undefined}
      data-button-type={type}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/services/marketApi', () => ({
  marketApiService: {
    searchSkill: marketApiMocks.searchSkill,
  },
}));

vi.mock('@/services/skill', () => ({
  agentSkillService: {
    importFromMarket: skillServiceMocks.importFromMarket,
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  Modal: ({ children, open, width }: { children?: ReactNode; open?: boolean; width?: string }) =>
    open ? (
      <div data-modal-width={width} role="dialog">
        {children}
      </div>
    ) : null,
}));

vi.mock('antd-style', () => ({
  cssVar: {
    borderRadiusLG: 8,
    colorError: '#f00',
    colorSuccess: '#0a0',
    colorTextDescription: '#666',
    colorTextSecondary: '#666',
    colorTextTertiary: '#999',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: (namespace: string) => ({
    t: (key: string, options?: Record<string, string>) => {
      const text =
        (
          {
            'chat:createModal.createBlank': 'Start Blank',
            'chat:createModal.groupPlaceholder': 'Describe what this Group should do...',
            'chat:createModal.groupTitle': 'What should this Group do?',
            'chat:createModal.placeholder': 'Describe what this Agent should do...',
            'chat:inbox.title': 'Lobe AI',
            'chat:createModal.skillSuggestion.actions.createAnyway': 'Create Agent Anyway',
            'chat:createModal.skillSuggestion.actions.createAnywayHint': 'Skill not a fit?',
            'chat:createModal.skillSuggestion.actions.install': 'Install Skill',
            'chat:createModal.skillSuggestion.actions.installing': 'Installing…',
            'chat:createModal.skillSuggestion.actions.openSkills': 'View in Skills',
            'chat:createModal.skillSuggestion.actions.tryInLobeAI': 'Use in {{name}}',
            'chat:createModal.skillSuggestion.description':
              'This looks like a reusable workflow. Install the Skill once, then use it across Agents.',
            'chat:createModal.skillSuggestion.installed.description':
              'You can use this Skill in {{name}}, or enable it for any Agent.',
            'chat:createModal.skillSuggestion.installed.ready': 'Ready in {{name}}',
            'chat:createModal.skillSuggestion.installed.title': 'Skill installed',
            'chat:createModal.skillSuggestion.installError':
              "Skill wasn't installed. Retry, or create an Agent anyway.",
            'chat:createModal.skillSuggestion.title': 'A Skill may fit better',
            'chat:createModal.title': 'What should this Agent do?',
            'common:home.suggestQuestions': 'Try these examples',
            'common:switch': 'Switch',
            'suggestQuestions:example.prompt': 'Use this example prompt',
            'suggestQuestions:example.title': 'Example title',
          } as Record<string, string>
        )[`${namespace}:${key}`] ?? key;

      return text.replaceAll('{{name}}', options?.name ?? 'LobeAI');
    },
  }),
}));

vi.mock('@/features/ChatInput', () => ({
  ChatInputProvider: ({
    children,
    chatInputEditorRef,
    onMarkdownContentChange,
    onSend,
  }: {
    children?: ReactNode;
    chatInputEditorRef?: (editor: typeof chatInputState.editor) => void;
    onMarkdownContentChange?: (content: string) => void;
    onSend?: () => void;
  }) => {
    chatInputState.onMarkdownContentChange = onMarkdownContentChange;
    chatInputState.onSend = onSend;
    chatInputEditorRef?.(chatInputState.editor);

    return <div>{children}</div>;
  },
  DesktopChatInput: ({ placeholder }: { placeholder?: string }) => (
    <div>
      <textarea
        aria-label="chat input"
        placeholder={placeholder}
        onChange={(event) => {
          chatInputState.onMarkdownContentChange?.(event.currentTarget.value);
        }}
      />
      <button
        type="button"
        onClick={() => {
          chatInputState.onSend?.();
        }}
      >
        Send
      </button>
    </div>
  ),
}));

vi.mock('@/routes/(main)/home/features/SuggestQuestions/useRandomQuestions', () => ({
  useRandomQuestions: () => ({
    questions: [
      {
        id: 'example-1',
        promptKey: 'example.prompt',
        titleKey: 'example.title',
      },
    ],
    refresh: vi.fn(),
  }),
}));

vi.mock('@/store/user', () => ({
  getUserStoreState: () => ({ telemetry: telemetryState.enabled }),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    telemetry: (state: { telemetry: boolean }) => state.telemetry,
  },
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (
    selector: (state: { refreshAgentSkills: typeof toolStoreMocks.refreshAgentSkills }) => unknown,
  ) =>
    selector({
      refreshAgentSkills: toolStoreMocks.refreshAgentSkills,
    }),
}));

const renderModal = (type: 'agent' | 'group' = 'agent') => {
  const onClose = vi.fn();
  const onCreateBlank = vi.fn().mockResolvedValue(undefined);
  const onOpenSkills = vi.fn();
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onTryInLobeAI = vi.fn();

  render(
    <CreateAgentModal
      open
      agentId="inbox-agent"
      inboxAgentName="Nova"
      type={type}
      onClose={onClose}
      onCreateBlank={onCreateBlank}
      onOpenSkills={onOpenSkills}
      onSubmit={onSubmit}
      onTryInLobeAI={onTryInLobeAI}
    />,
  );

  return { onClose, onCreateBlank, onOpenSkills, onSubmit, onTryInLobeAI };
};

const expectTrackedSkillSuggestionAction = async (
  action: string,
  properties: Record<string, unknown> = {},
) => {
  await waitFor(() => {
    expect(analyticsTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'create_agent_modal_skill_suggestion_action',
        properties: expect.objectContaining({
          action,
          ...properties,
        }),
      }),
    );
  });
};

describe('CreateAgentModal analytics', () => {
  beforeEach(() => {
    analyticsTrack.mockReset();
    marketApiMocks.searchSkill.mockReset();
    marketApiMocks.searchSkill.mockResolvedValue({
      currentPage: 1,
      items: [],
      pageSize: 3,
      totalCount: 0,
      totalPages: 0,
    });
    skillServiceMocks.importFromMarket.mockReset();
    skillServiceMocks.importFromMarket.mockResolvedValue({
      skill: { id: 'skill-1', name: 'Resume Reviewer' },
      status: 'created',
    });
    telemetryState.enabled = true;
    chatInputState.onMarkdownContentChange = undefined;
    chatInputState.onSend = undefined;
    toolStoreMocks.refreshAgentSkills.mockReset();
    vi.mocked(chatInputState.editor.focus).mockClear();
    vi.mocked(chatInputState.editor.instance.setDocument).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('tracks manual submit source after successful agent creation submit', async () => {
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: 'Create a research assistant' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Create a research assistant');
    });
    await waitFor(() => {
      expect(analyticsTrack).toHaveBeenCalledWith({
        name: 'create_agent_modal_creation_succeeded',
        properties: {
          source: 'manual',
          spm: 'home.create_agent_modal.submit',
          type: 'agent',
        },
      });
    });
  });

  it('tracks example submit source when the user submits an example unchanged', async () => {
    const { onSubmit } = renderModal();

    fireEvent.click(screen.getByText('Example title'));
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('Use this example prompt');
    });
    await waitFor(() => {
      expect(analyticsTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({ source: 'example' }),
        }),
      );
    });
  });

  it('tracks example_edited when an example is changed before submit', async () => {
    renderModal();

    fireEvent.click(screen.getByText('Example title'));
    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: 'Edited example prompt' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(analyticsTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({ source: 'example_edited' }),
        }),
      );
    });
  });

  it('tracks blank source when Start Blank succeeds', async () => {
    const { onCreateBlank } = renderModal();

    fireEvent.click(screen.getByText('Start Blank'));

    await waitFor(() => {
      expect(onCreateBlank).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(analyticsTrack).toHaveBeenCalledWith({
        name: 'create_agent_modal_creation_succeeded',
        properties: {
          source: 'blank',
          spm: 'home.create_agent_modal.submit',
          type: 'agent',
        },
      });
    });
  });

  it('does not track when telemetry is disabled', async () => {
    telemetryState.enabled = false;
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: 'Create a research assistant' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(analyticsTrack).not.toHaveBeenCalled();
  });

  it('does not track group submits through the create agent event', async () => {
    const { onSubmit } = renderModal('group');

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: 'Create a research group' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(analyticsTrack).not.toHaveBeenCalled();
  });

  it('interrupts high-confidence skill prompts with a stronger skill recommendation', async () => {
    marketApiMocks.searchSkill.mockResolvedValueOnce({
      currentPage: 1,
      items: [
        {
          createdAt: '2026-01-01',
          description: 'Review and improve resumes with a reusable checklist.',
          identifier: 'resume-reviewer',
          installCount: 12,
          name: 'Resume Reviewer',
          updatedAt: '2026-01-01',
        },
      ],
      pageSize: 3,
      totalCount: 1,
      totalPages: 1,
    });
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: '帮我做一个简历优化检查清单' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(marketApiMocks.searchSkill).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 3, q: 'resume review', sort: 'relevance' }),
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('A Skill may fit better')).toBeInTheDocument();
    expect(screen.getByText('Resume Reviewer')).toBeInTheDocument();
    expect(screen.queryByText('Example title')).not.toBeInTheDocument();
    expect(screen.getByText('Skill not a fit?')).toBeInTheDocument();
    await expectTrackedSkillSuggestionAction('shown', {
      skill_count: 1,
      source: 'manual',
      top_skill_identifier: 'resume-reviewer',
    });

    expect(screen.getByText('Install Skill')).toHaveAttribute('data-button-type', 'primary');

    const createAnywayButton = screen.getByText('Create Agent Anyway');
    expect(createAnywayButton).not.toHaveAttribute('data-button-type', 'primary');
    fireEvent.click(createAnywayButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('帮我做一个简历优化检查清单');
    });
    await expectTrackedSkillSuggestionAction('create_agent_anyway_clicked', {
      skill_count: 1,
      source: 'manual',
      top_skill_identifier: 'resume-reviewer',
    });
    await waitFor(() => {
      expect(analyticsTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'create_agent_modal_creation_succeeded',
          properties: expect.objectContaining({ source: 'manual' }),
        }),
      );
    });
  });

  it('does not interrupt ambiguous long-term agent prompts', async () => {
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: '创建一个代码学习导师，长期跟进我的学习计划' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('创建一个代码学习导师，长期跟进我的学习计划');
    });
    expect(marketApiMocks.searchSkill).not.toHaveBeenCalled();
    expect(screen.queryByText('A Skill may fit better')).not.toBeInTheDocument();
  });

  it('interrupts role-framed reusable prompts when the role maps to a skill workflow', async () => {
    marketApiMocks.searchSkill.mockResolvedValueOnce({
      currentPage: 1,
      items: [
        {
          createdAt: '2026-01-01',
          description: 'Review and improve resumes with a reusable checklist.',
          identifier: 'resume-reviewer',
          installCount: 12,
          name: 'Resume Reviewer',
          updatedAt: '2026-01-01',
        },
      ],
      pageSize: 3,
      totalCount: 1,
      totalPages: 1,
    });
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: '帮我创建一个简历优化助手' },
    });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => {
      expect(marketApiMocks.searchSkill).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 3, q: 'resume review', sort: 'relevance' }),
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('A Skill may fit better')).toBeInTheDocument();
  });

  it('keeps install skill buttons visually consistent when multiple skill suggestions are shown', async () => {
    marketApiMocks.searchSkill.mockResolvedValueOnce({
      currentPage: 1,
      items: [
        {
          createdAt: '2026-01-01',
          description: 'Guided statistical analysis with test selection and reporting.',
          identifier: 'statistical-analysis',
          installCount: 12,
          name: 'statistical-analysis',
          updatedAt: '2026-01-01',
        },
        {
          createdAt: '2026-01-01',
          description: 'Perform comprehensive exploratory data analysis.',
          identifier: 'exploratory-data-analysis',
          installCount: 8,
          name: 'exploratory-data-analysis',
          updatedAt: '2026-01-01',
        },
        {
          createdAt: '2026-01-01',
          description: 'Neuropixels neural recording analysis.',
          identifier: 'neuropixels-analysis',
          installCount: 5,
          name: 'neuropixels-analysis',
          updatedAt: '2026-01-01',
        },
      ],
      pageSize: 3,
      totalCount: 3,
      totalPages: 1,
    });
    renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: '创建一个擅长做 PPT Word Excel 的 Agent' },
    });
    fireEvent.click(screen.getByText('Send'));

    expect(await screen.findByText('A Skill may fit better')).toBeInTheDocument();

    const installSkillButtons = screen.getAllByText('Install Skill');
    expect(installSkillButtons).toHaveLength(3);
    installSkillButtons.forEach((button) => {
      expect(button).not.toHaveAttribute('data-button-type', 'primary');
    });
  });

  it('shows an installing state while installing the suggested skill', async () => {
    marketApiMocks.searchSkill.mockResolvedValueOnce({
      currentPage: 1,
      items: [
        {
          createdAt: '2026-01-01',
          description: 'Review and improve resumes with a reusable checklist.',
          identifier: 'resume-reviewer',
          installCount: 12,
          name: 'Resume Reviewer',
          updatedAt: '2026-01-01',
        },
      ],
      pageSize: 3,
      totalCount: 1,
      totalPages: 1,
    });
    let resolveImport: (value: {
      skill: { id: string; name: string };
      status: string;
    }) => void = () => {};
    skillServiceMocks.importFromMarket.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: '帮我做一个简历优化检查清单' },
    });
    fireEvent.click(screen.getByText('Send'));

    expect(await screen.findByText('A Skill may fit better')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Install Skill'));

    const installingButton = await screen.findByText('Installing…');
    expect(installingButton).toHaveAttribute('data-button-loading', 'true');
    expect(screen.queryByText('Install Skill')).not.toBeInTheDocument();

    resolveImport({ skill: { id: 'skill-1', name: 'Resume Reviewer' }, status: 'created' });
    expect(await screen.findByText('Skill installed')).toBeInTheDocument();
  });

  it('shows a completed skill state after installing the recommended skill', async () => {
    marketApiMocks.searchSkill.mockResolvedValueOnce({
      currentPage: 1,
      items: [
        {
          createdAt: '2026-01-01',
          description: 'Review and improve resumes with a reusable checklist.',
          identifier: 'resume-reviewer',
          installCount: 12,
          name: 'Resume Reviewer',
          updatedAt: '2026-01-01',
        },
      ],
      pageSize: 3,
      totalCount: 1,
      totalPages: 1,
    });
    const { onClose, onOpenSkills, onSubmit, onTryInLobeAI } = renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: '帮我做一个简历优化检查清单' },
    });
    fireEvent.click(screen.getByText('Send'));

    expect(await screen.findByText('A Skill may fit better')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Install Skill'));

    await waitFor(() => {
      expect(skillServiceMocks.importFromMarket).toHaveBeenCalledWith('resume-reviewer');
    });
    await expectTrackedSkillSuggestionAction('install_clicked', {
      selected_skill_identifier: 'resume-reviewer',
    });
    await expectTrackedSkillSuggestionAction('install_succeeded', {
      selected_skill_identifier: 'resume-reviewer',
    });
    expect(toolStoreMocks.refreshAgentSkills).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByText('Skill installed')).toBeInTheDocument();
    expect(screen.getByText('Resume Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Ready in Nova')).toBeInTheDocument();
    expect(
      screen.getByText('You can use this Skill in Nova, or enable it for any Agent.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('resume-reviewer')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-modal-width', 'min(90vw, 560px)');
    expect(screen.queryByText('Skill not a fit?')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Agent Anyway')).not.toBeInTheDocument();

    const tryInLobeAIButton = screen.getByText('Use in Nova');
    expect(tryInLobeAIButton).toHaveAttribute('data-button-type', 'primary');
    const openSkillsButton = screen.getByText('View in Skills');
    expect(openSkillsButton).not.toHaveAttribute('data-button-type', 'primary');
    fireEvent.click(openSkillsButton);

    expect(onOpenSkills).toHaveBeenCalledWith('resume-reviewer');
    await expectTrackedSkillSuggestionAction('open_skills_clicked', {
      selected_skill_identifier: 'resume-reviewer',
    });

    fireEvent.click(tryInLobeAIButton);
    expect(onTryInLobeAI).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    await expectTrackedSkillSuggestionAction('try_in_lobeai_clicked', {
      selected_skill_identifier: 'resume-reviewer',
    });
  });

  it('keeps the suggestion visible when installing the recommended skill fails', async () => {
    marketApiMocks.searchSkill.mockResolvedValueOnce({
      currentPage: 1,
      items: [
        {
          createdAt: '2026-01-01',
          description: 'Review and improve resumes with a reusable checklist.',
          identifier: 'resume-reviewer',
          installCount: 12,
          name: 'Resume Reviewer',
          updatedAt: '2026-01-01',
        },
      ],
      pageSize: 3,
      totalCount: 1,
      totalPages: 1,
    });
    skillServiceMocks.importFromMarket.mockRejectedValueOnce(new Error('Import failed'));
    const { onClose } = renderModal();

    fireEvent.change(screen.getByLabelText('chat input'), {
      target: { value: '帮我做一个简历优化检查清单' },
    });
    fireEvent.click(screen.getByText('Send'));

    expect(await screen.findByText('A Skill may fit better')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Install Skill'));

    await waitFor(() => {
      expect(skillServiceMocks.importFromMarket).toHaveBeenCalledWith('resume-reviewer');
    });
    expect(toolStoreMocks.refreshAgentSkills).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await expectTrackedSkillSuggestionAction('install_failed', {
      selected_skill_identifier: 'resume-reviewer',
    });
    expect(
      await screen.findByText("Skill wasn't installed. Retry, or create an Agent anyway."),
    ).toBeInTheDocument();
  });
});
