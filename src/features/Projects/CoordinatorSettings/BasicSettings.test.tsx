/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectService } from '@/services/project';
import { useAgentStore } from '@/store/agent';

import { CoordinatorBasicSettings } from './BasicSettings';
import type { ProjectCoordinatorConfig } from './useCoordinatorConfig';

vi.mock('@/hooks/useInitAgentConfig', () => ({ useInitAgentConfig: vi.fn() }));
vi.mock('@/features/ModelSelect', () => ({
  default: ({
    value,
    onChange,
  }: {
    onChange: (v: { model: string; provider: string }) => void;
    value?: { model: string; provider?: string };
  }) => (
    <button
      data-testid="model-select"
      type="button"
      onClick={() => onChange({ model: 'claude-sonnet-5-5', provider: 'anthropic' })}
    >
      {value?.model ?? 'none'}
    </button>
  ),
}));

const baseConfig = (): ProjectCoordinatorConfig => ({
  agentId: 'agt_coord',
  config: {
    agencyConfig: null,
    avatar: null,
    botProviders: [
      { applicationId: '7012345678', enabled: true, platform: 'telegram', settings: null },
    ],
    chatConfig: null,
    description: 'Coordinates the launch',
    model: 'gpt-5',
    openingMessage: null,
    openingQuestions: null,
    params: { temperature: 0.4 },
    plugins: [],
    provider: 'openai',
    systemRole: 'You lead the launch project.',
    title: 'Launch Coordinator',
    tts: null,
    virtual: false,
  },
  editable: true,
  ownerProjectId: 'prj_1',
  projectId: 'prj_1',
  responsibility: null,
  sharedWithProjectIds: [],
  source: 'owned',
});

const renderSettings = (config = baseConfig(), disabled = false) =>
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <CoordinatorBasicSettings
        config={config}
        disabled={disabled}
        projectId="prj_1"
        onOpenChannels={vi.fn()}
      />
    </SWRConfig>,
  );

/** Each card saves on its own; the cards render prompt first, then model. */
const saveButtons = () => screen.getAllByRole('button', { name: 'save' });

describe('CoordinatorBasicSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(projectService, 'getCoordinatorConfig').mockResolvedValue(baseConfig());
    useAgentStore.setState({
      agentMap: {},
      internal_refreshAgentConfig: vi.fn(async () => {}),
    } as any);
  });

  it('shows the resolved prompt, model and IM connections', () => {
    renderSettings();

    expect(screen.getByDisplayValue('You lead the launch project.')).toBeInTheDocument();
    expect(screen.getByTestId('model-select')).toHaveTextContent('gpt-5');
    expect(screen.getByText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('coordinator.channel.applicationId')).toBeInTheDocument();
    expect(screen.getByText('coordinator.channel.enabled')).toBeInTheDocument();
  });

  it('writes an edited prompt through the project', async () => {
    const update = vi.spyOn(projectService, 'updateCoordinatorConfig').mockResolvedValue({
      ...baseConfig(),
      config: { ...baseConfig().config, systemRole: 'New prompt' },
    });
    renderSettings();

    fireEvent.change(screen.getByDisplayValue('You lead the launch project.'), {
      target: { value: 'New prompt' },
    });
    fireEvent.click(saveButtons()[0]);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('prj_1', { config: { systemRole: 'New prompt' } }),
    );
    expect(useAgentStore.getState().internal_refreshAgentConfig).toHaveBeenCalledWith('agt_coord');
  });

  it('writes the picked model, provider and parameters through the project', async () => {
    const update = vi
      .spyOn(projectService, 'updateCoordinatorConfig')
      .mockResolvedValue(baseConfig());
    renderSettings();

    fireEvent.click(screen.getByTestId('model-select'));
    fireEvent.click(saveButtons()[1]);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('prj_1', {
        config: {
          model: 'claude-sonnet-5-5',
          params: { temperature: 0.4, top_p: undefined },
          provider: 'anthropic',
        },
      }),
    );
  });

  it('disables editing when the project may not write the main agent', () => {
    renderSettings({ ...baseConfig(), editable: false }, true);

    expect(screen.getByDisplayValue('You lead the launch project.')).toBeDisabled();
  });
});
