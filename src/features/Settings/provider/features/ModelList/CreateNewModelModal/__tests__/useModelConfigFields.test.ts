import { useForm } from '@lobehub/ui/form';
import { act, renderHook } from '@testing-library/react';
import type { AiModelType } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { useModelConfigFields } from '../useModelConfigFields';

const renderFields = (type: AiModelType | undefined, provider: string | undefined) =>
  renderHook(() => {
    const form = useForm({ initialValues: type ? { type } : {} });
    return { form, ...useModelConfigFields(form, type, provider) };
  });

describe('useModelConfigFields', () => {
  it('hides the cache duration once a chat model is switched to a non-chat type', () => {
    const { result } = renderFields('chat', 'anthropic');
    expect(result.current.showContextCachingTTL).toBe(true);

    act(() => result.current.form.setValue('type', 'tts'));

    expect(result.current.showContextCachingTTL).toBe(false);
    expect(result.current.showTTSVoice).toBe(true);
  });

  it('shows the cache duration once a non-chat model is switched to chat', () => {
    const { result } = renderFields('tts', 'anthropic');
    expect(result.current.showContextCachingTTL).toBe(false);

    act(() => result.current.form.setValue('type', 'chat'));

    expect(result.current.showContextCachingTTL).toBe(true);
    expect(result.current.showTTSVoice).toBe(false);
  });

  it('shows the cache duration for a new model until a non-chat type is picked', () => {
    const { result } = renderFields(undefined, 'anthropic');
    expect(result.current.showContextCachingTTL).toBe(true);

    act(() => result.current.form.setValue('type', 'embedding'));

    expect(result.current.showContextCachingTTL).toBe(false);
  });

  it('hides the cache duration without an active provider', () => {
    expect(renderFields('chat', undefined).result.current.showContextCachingTTL).toBe(false);
  });
});
