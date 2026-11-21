import { describe, expect, it } from 'vitest';

import {
  gatePromptSuggestionArgs,
  PROMPT_SUGGESTIONS_ARG,
  toPromptSuggestionData,
  withPromptSuggestionArg,
} from './claudeCodePromptSuggestions';

describe('withPromptSuggestionArg', () => {
  it('adds the flag only when enabled', () => {
    expect(withPromptSuggestionArg(['--model', 'x'], true)).toEqual([
      '--model',
      'x',
      PROMPT_SUGGESTIONS_ARG,
    ]);
    expect(withPromptSuggestionArg(undefined, true)).toEqual([PROMPT_SUGGESTIONS_ARG]);
    expect(withPromptSuggestionArg(['--model', 'x'], false)).toEqual(['--model', 'x']);
  });

  it.each(['--prompt-suggestions', '--prompt-suggestions=false'])(
    'keeps the user-configured %s',
    (arg) => {
      expect(withPromptSuggestionArg([arg], true)).toEqual([arg]);
    },
  );
});

describe('gatePromptSuggestionArgs', () => {
  const args = ['--model', 'x', PROMPT_SUGGESTIONS_ARG];

  it.each(['2.1.48', '2.1.330 (Claude Code)', '2.2.0', '3.0.0'])('keeps the flag on %s', (v) => {
    expect(gatePromptSuggestionArgs(args, v)).toEqual(args);
  });

  it.each(['2.1.47', '2.0.99', '1.9.100', 'unknown', undefined])('drops the flag on %s', (v) => {
    expect(gatePromptSuggestionArgs(args, v)).toEqual(['--model', 'x']);
  });

  it('leaves a flag the user configured themselves', () => {
    expect(gatePromptSuggestionArgs(['--prompt-suggestions'], '2.0.0')).toEqual([
      '--prompt-suggestions',
    ]);
  });
});

describe('toPromptSuggestionData', () => {
  it('trims a real suggestion', () => {
    expect(toPromptSuggestionData({ suggestion: '  run the tests ' })).toEqual({
      phase: 'prompt_suggestion',
      suggestion: 'run the tests',
    });
  });

  it.each([{ suggestion: '   ' }, { suggestion: 1 }, {}, null])('ignores %j', (raw) => {
    expect(toPromptSuggestionData(raw)).toBeUndefined();
  });
});
