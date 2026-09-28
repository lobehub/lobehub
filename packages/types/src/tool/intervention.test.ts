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
});
