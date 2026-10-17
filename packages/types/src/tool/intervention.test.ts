import { describe, expect, it } from 'vitest';

import { classifyToolInterventionPresentation } from './intervention';

describe('classifyToolInterventionPresentation', () => {
  it('renders Devin questions and provider-specific interactions as forms', () => {
    expect(classifyToolInterventionPresentation('devin', 'askUserQuestion')).toEqual({
      interactionKind: 'question',
      surface: 'form',
    });
    expect(classifyToolInterventionPresentation('devin', 'requestPermission')).toEqual({
      interactionKind: 'custom',
      surface: 'form',
    });
  });

  it('keeps the secure credential form an approval that only its card can resolve', () => {
    expect(classifyToolInterventionPresentation('lobe-creds', 'requestCredsInput')).toEqual({
      interactionKind: 'tool_approval',
      surface: 'form',
    });
    expect(classifyToolInterventionPresentation('lobe-creds', 'injectCredsToSandbox')).toEqual({
      interactionKind: 'tool_approval',
      surface: 'binary',
    });
  });
});
