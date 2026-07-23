import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { describe, expect, it } from 'vitest';

import { getRuntimeErrorMessage } from './runtimeErrorMessage';

const createTranslator =
  (translations: Record<string, string>) => (key: string, options?: Record<string, unknown>) =>
    translations[key] ?? String(options?.defaultValue ?? key);

describe('getRuntimeErrorMessage', () => {
  it('returns the localized runtime error message when the key exists', () => {
    const t = createTranslator({
      'modelRuntime:ModelEmptyCompletion': 'Localized empty completion',
    });

    expect(getRuntimeErrorMessage(t, AgentRuntimeErrorType.ModelEmptyCompletion)).toBe(
      'Localized empty completion',
    );
  });

  it('returns the raw fallback when a registered runtime error has no locale key', () => {
    const t = createTranslator({});

    expect(
      getRuntimeErrorMessage(
        t,
        AgentRuntimeErrorType.InvalidGithubCopilotToken,
        undefined,
        'The GitHub Copilot token is invalid.',
      ),
    ).toBe('The GitHub Copilot token is invalid.');
  });
});
