import { isKimiModelCandidate } from '@lobechat/heterogeneous-agents';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LobeDefaultAiModelListItem } from 'model-bank';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import ModelSelect from '@/features/ModelSelect';

import {
  buildServerDefaultModelOptions,
  compactModelTriggerText,
  renderKimiModelOption,
  resolveServerDefaultAgentModels,
  resolveServerDefaultModelMeta,
} from './modelPicker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/store/aiInfra', () => ({
  useAiInfraStore: (selector: (state: unknown) => unknown) =>
    selector({
      builtinAiModelList: [],
      enabledChatModelList: [
        {
          id: 'custom',
          children: [
            { id: 'with-tools', abilities: { functionCall: true } },
            { id: 'unknown-tools', abilities: {} },
            { id: 'no-tools', abilities: { functionCall: false } },
          ],
        },
      ],
    }),
}));

const catalogItem = (partial: {
  displayName?: string;
  id: string;
  providerId: string;
}): LobeDefaultAiModelListItem =>
  ({
    abilities: {},
    ...partial,
  }) as LobeDefaultAiModelListItem;

describe('Kimi custom-provider model options', () => {
  it('shows distinct compatibility hints in the real picker and excludes unsupported models', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      createElement(ModelSelect, {
        modelFilter: isKimiModelCandidate,
        modelOptionRender: renderKimiModelOption,
        onChange,
        value: { model: 'with-tools', provider: 'custom' },
      }),
    );

    await user.click(screen.getByRole('combobox'));
    const supported = await screen.findByRole('option', { name: /with-tools/ });
    const unknown = screen.getByRole('option', { name: /unknown-tools/ });
    expect(
      within(supported).getByText('heterogeneousStatus.apiMode.compatibility.untested'),
    ).toBeInTheDocument();
    expect(
      within(unknown).getByText('heterogeneousStatus.apiMode.compatibility.toolsUnknown'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /no-tools/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).not.toHaveTextContent('compatibility');

    await user.click(unknown);
    expect(onChange).toHaveBeenCalledWith({ model: 'unknown-tools', provider: 'custom' });
  });
});

describe('resolveServerDefaultAgentModels', () => {
  it('returns an empty list when an older server omits the requested agent entry', () => {
    const legacyModels = {
      'claude-code': [{ model: 'claude-sonnet-4-6' }],
      'codex': [{ model: 'gpt-5.6' }],
    };

    expect(resolveServerDefaultAgentModels(legacyModels, 'kimi-code')).toEqual([]);
    expect(resolveServerDefaultAgentModels(legacyModels, 'claude-code')).toEqual([
      { model: 'claude-sonnet-4-6' },
    ]);
  });
});

describe('resolveServerDefaultModelMeta', () => {
  it('prefers the LobeHub catalog entry over another provider with the same id', () => {
    const meta = resolveServerDefaultModelMeta('gpt-5.6', [
      catalogItem({ displayName: 'OpenAI GPT', id: 'gpt-5.6', providerId: 'openai' }),
      catalogItem({ displayName: 'GPT-5.6', id: 'gpt-5.6', providerId: 'lobehub' }),
    ]);

    expect(meta?.displayName).toBe('GPT-5.6');
  });

  it('falls back to any catalog match, then to undefined', () => {
    expect(
      resolveServerDefaultModelMeta('gpt-5.6', [
        catalogItem({ displayName: 'OpenAI GPT', id: 'gpt-5.6', providerId: 'openai' }),
      ])?.displayName,
    ).toBe('OpenAI GPT');
    expect(resolveServerDefaultModelMeta('gpt-5.6-sol', [])).toBeUndefined();
  });
});

describe('compactModelTriggerText', () => {
  it('uses the Select title when present', () => {
    expect(compactModelTriggerText({ title: 'GPT-5.6', value: 'gpt-5.6' })).toBe('GPT-5.6');
    expect(
      compactModelTriggerText({ title: 'Claude Opus 4.1', value: 'anthropic/claude-opus-4-1' }),
    ).toBe('Claude Opus 4.1');
  });

  it('falls back to the model id, not a namespaced provider/model value', () => {
    expect(compactModelTriggerText({ value: 'anthropic/claude-opus-4-1' })).toBe('claude-opus-4-1');
    expect(compactModelTriggerText({ value: 'gpt-5.6' })).toBe('gpt-5.6');
  });
});

describe('buildServerDefaultModelOptions', () => {
  it.each(['untested', 'toolsUnknown'] as const)(
    'renders %s without changing the model title or claiming verification',
    (compatibility) => {
      const [option] = buildServerDefaultModelOptions(
        [{ model: 'glm-5v-turbo', compatibility }],
        [catalogItem({ displayName: 'GLM-5V Turbo', id: 'glm-5v-turbo', providerId: 'lobehub' })],
      );
      expect(option.title).toBe('GLM-5V Turbo');
      expect(renderToStaticMarkup(option.label)).toContain(`compatibility.${compatibility}`);
    },
  );

  it('puts the catalog display name on Select title for the closed trigger', () => {
    const options = buildServerDefaultModelOptions(
      [{ model: 'gpt-5.6' }],
      [catalogItem({ displayName: 'GPT-5.6', id: 'gpt-5.6', providerId: 'lobehub' })],
    );

    expect(options[0]).toMatchObject({ title: 'GPT-5.6', value: 'gpt-5.6' });
  });
});
