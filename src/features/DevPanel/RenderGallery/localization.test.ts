import { type TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import { localizeRenderGalleryApi, localizeRenderGalleryToolset } from './localization';

const createTranslator = (translations: Record<string, string> = {}) =>
  vi.fn(
    (key: string, options?: { defaultValue?: string }) =>
      translations[key] ?? options?.defaultValue ?? key,
  ) as unknown as TFunction<'plugin'>;

describe('Render Gallery localization', () => {
  it('localizes toolset and API metadata from the plugin namespace', () => {
    const t = createTranslator({
      'builtins.lobe-task.apiDescription.viewTask': '查看指定任务的详细信息。',
      'builtins.lobe-task.apiName.viewTask': '查看任务',
      'builtins.lobe-task.description': '管理并执行任务。',
      'builtins.lobe-task.title': '任务工具',
    });

    expect(
      localizeRenderGalleryToolset(
        {
          identifier: 'lobe-task',
          toolsetDescription: 'Manage and execute tasks.',
          toolsetName: 'Task Tools',
        },
        t,
      ),
    ).toMatchObject({ toolsetDescription: '管理并执行任务。', toolsetName: '任务工具' });

    expect(
      localizeRenderGalleryApi(
        {
          apiName: 'viewTask',
          description: 'View details of a task.',
          identifier: 'lobe-task',
        },
        t,
      ),
    ).toMatchObject({ apiDisplayName: '查看任务', description: '查看指定任务的详细信息。' });
  });

  it('falls back to registry metadata when translations are unavailable', () => {
    const t = createTranslator();

    expect(
      localizeRenderGalleryApi(
        { apiName: 'customAction', description: 'Custom action', identifier: 'custom-tool' },
        t,
      ),
    ).toMatchObject({ apiDisplayName: 'customAction', description: 'Custom action' });
  });
});
