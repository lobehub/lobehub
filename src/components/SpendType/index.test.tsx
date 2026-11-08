import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SpendType from './index';

const renderIconClass = (type: Parameters<typeof SpendType>[0]['type']) =>
  render(<SpendType type={type} />)
    .container.querySelector('svg')
    ?.getAttribute('class');

describe('SpendType', () => {
  it('renders the audio-lines icon for text-to-speech spend', () => {
    expect(renderIconClass('textToSpeech')).toContain('lucide-audio-lines');
  });

  it('keeps the microphone icon for speech recognition spend', () => {
    expect(renderIconClass('speechRecognition')).toContain('lucide-mic');
  });
});
