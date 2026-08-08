/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AskUserQuestionArgs } from './types';
import { useAskUserForm } from './useAskUserForm';

const singleQuestionArgs: AskUserQuestionArgs = {
  questions: [
    {
      header: 'Scope',
      options: [{ label: 'Narrow' }, { label: 'Full' }],
      question: 'How broad?',
    },
  ],
};

const twoQuestionArgs: AskUserQuestionArgs = {
  questions: [
    {
      header: 'Scope',
      options: [{ label: 'Narrow' }, { label: 'Full' }],
      question: 'How broad?',
    },
    {
      header: 'Mode',
      options: [{ label: 'Auto' }, { label: 'Manual' }],
      question: 'Which mode?',
    },
  ],
};

const setup = (args: AskUserQuestionArgs, persistedDraft?: unknown) => {
  const onInteractionAction = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(() =>
    useAskUserForm({
      args,
      onInteractionAction,
      persistedDraft,
      writeDraft: vi.fn(),
    }),
  );
  return { hook, onInteractionAction };
};

describe('useAskUserForm select-to-submit', () => {
  it('submits immediately when a keyboard single-select pick completes the form', () => {
    const { hook, onInteractionAction } = setup(singleQuestionArgs);

    act(() => {
      hook.result.current.handleToggle(singleQuestionArgs.questions[0], 'Full', {
        submitOnComplete: true,
      });
    });

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': 'Full' },
      type: 'submit',
    });
  });

  it('never submits on a plain (mouse-click) toggle, even when it completes the form', () => {
    // Regression: clicking an option must only select it — accidental clicks
    // were submitting the whole form when select-to-submit applied to clicks.
    const { hook, onInteractionAction } = setup(singleQuestionArgs);

    act(() => {
      hook.result.current.handleToggle(singleQuestionArgs.questions[0], 'Full');
    });

    expect(onInteractionAction).not.toHaveBeenCalled();
    expect(hook.result.current.picks['How broad?']).toBe('Full');

    act(() => {
      hook.result.current.handleSubmit();
    });

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': 'Full' },
      type: 'submit',
    });
  });

  it('auto-advances instead of submitting while other questions are unanswered', () => {
    const { hook, onInteractionAction } = setup(twoQuestionArgs);

    act(() => {
      hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow', {
        submitOnComplete: true,
      });
    });

    expect(onInteractionAction).not.toHaveBeenCalled();
    expect(hook.result.current.activeTab).toBe('1');

    act(() => {
      hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto', {
        submitOnComplete: true,
      });
    });

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': 'Narrow', 'Which mode?': 'Auto' },
      type: 'submit',
    });
  });

  it('never auto-submits when revisiting an already-answered question', () => {
    // Resumed draft with every question answered — changing a pick must stay a
    // review edit, not a surprise submit.
    const { hook, onInteractionAction } = setup(twoQuestionArgs, {
      picks: { 'How broad?': 'Narrow', 'Which mode?': 'Auto' },
    });

    act(() => {
      hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Full', {
        submitOnComplete: true,
      });
    });

    expect(onInteractionAction).not.toHaveBeenCalled();
    expect(hook.result.current.picks['How broad?']).toBe('Full');
  });

  it('keeps multi-select on explicit submit even when the toggle answers everything', () => {
    const args: AskUserQuestionArgs = {
      questions: [
        {
          header: 'Scope',
          multiSelect: true,
          options: [{ label: 'Narrow' }, { label: 'Full' }],
          question: 'How broad?',
        },
      ],
    };
    const { hook, onInteractionAction } = setup(args);

    act(() => {
      hook.result.current.handleToggle(args.questions[0], 'Narrow', { submitOnComplete: true });
    });

    expect(onInteractionAction).not.toHaveBeenCalled();

    act(() => {
      hook.result.current.handleSubmit();
    });

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: { 'How broad?': ['Narrow'] },
      type: 'submit',
    });
  });
});
