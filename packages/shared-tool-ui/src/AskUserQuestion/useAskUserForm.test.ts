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
  const writeDraft = vi.fn();
  const hook = renderHook(() =>
    useAskUserForm({
      args,
      onInteractionAction,
      persistedDraft,
      writeDraft,
    }),
  );
  return { hook, onInteractionAction, writeDraft };
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

describe('useAskUserForm additional notes', () => {
  it('allows additional notes on a single-question prompt', () => {
    const { hook, onInteractionAction } = setup(singleQuestionArgs);

    act(() => hook.result.current.handleToggle(singleQuestionArgs.questions[0], 'Full'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('One-question context.'));
    act(() => hook.result.current.handleSubmit());

    expect(hook.result.current.supplementActive).toBe(true);
    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Full',
        '__supplement__': 'One-question context.',
      },
      type: 'submit',
    });
  });

  it('keeps structured answers and appends additional notes', () => {
    const { hook, onInteractionAction } = setup(twoQuestionArgs);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('Keep existing behavior.'));
    act(() => hook.result.current.handleSubmit());

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Narrow',
        'Which mode?': 'Auto',
        '__supplement__': 'Keep existing behavior.',
      },
      type: 'submit',
    });
  });

  it('requires both complete answers and non-empty notes in additional-notes mode', () => {
    const { hook } = setup(twoQuestionArgs);

    act(() => hook.result.current.setSupplementMode(true));
    expect(hook.result.current.isSubmitDisabled).toBe(true);

    act(() => hook.result.current.handleSupplementTextChange('More context'));
    expect(hook.result.current.isSubmitDisabled).toBe(true);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto'));
    expect(hook.result.current.isSubmitDisabled).toBe(false);
  });

  it('keeps replace-all and additional-notes modes mutually exclusive', () => {
    const { hook } = setup(twoQuestionArgs);

    act(() => hook.result.current.setSupplementMode(true));
    expect(hook.result.current.supplementActive).toBe(true);
    expect(hook.result.current.escapeActive).toBe(false);

    act(() => hook.result.current.setEscapeMode(true));
    expect(hook.result.current.supplementActive).toBe(false);
    expect(hook.result.current.escapeActive).toBe(true);
  });

  it('restores additional-notes drafts without losing selected answers', () => {
    const { hook } = setup(twoQuestionArgs, {
      picks: { 'How broad?': 'Full', 'Which mode?': 'Manual' },
      supplementActive: true,
      supplementText: 'Preserve this note',
    });

    expect(hook.result.current.picks).toEqual({
      'How broad?': 'Full',
      'Which mode?': 'Manual',
    });
    expect(hook.result.current.supplementActive).toBe(true);
    expect(hook.result.current.supplementText).toBe('Preserve this note');
    expect(hook.result.current.isSubmitDisabled).toBe(false);
  });

  it('persists one atomic snapshot when returning from replace-all to a question', () => {
    const { hook, writeDraft } = setup(twoQuestionArgs);

    act(() => hook.result.current.setEscapeMode(true));
    act(() => hook.result.current.setQuestionMode('0'));

    expect(hook.result.current.escapeActive).toBe(false);
    expect(hook.result.current.supplementActive).toBe(false);
    expect(writeDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ escapeActive: false, supplementActive: false }),
    );
  });

  it('includes existing notes in keyboard select-to-submit', () => {
    const { hook, onInteractionAction } = setup(twoQuestionArgs);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('Keep this note.'));
    act(() => hook.result.current.setQuestionMode('1'));
    act(() =>
      hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto', {
        submitOnComplete: true,
      }),
    );

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Narrow',
        'Which mode?': 'Auto',
        '__supplement__': 'Keep this note.',
      },
      type: 'submit',
    });
  });

  it('includes saved notes on explicit submit after returning to a question', () => {
    const { hook, onInteractionAction } = setup(twoQuestionArgs);

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Narrow'));
    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[1], 'Auto'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('Keep this saved note.'));
    act(() => hook.result.current.setQuestionMode('0'));
    act(() => hook.result.current.handleSubmit());

    expect(hook.result.current.supplementActive).toBe(false);
    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Narrow',
        'Which mode?': 'Auto',
        '__supplement__': 'Keep this saved note.',
      },
      type: 'submit',
    });
  });

  it('includes saved notes in the timeout fallback after returning to a question', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T00:00:00Z'));
    const onInteractionAction = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useAskUserForm({
        args: twoQuestionArgs,
        countdownMs: 1000,
        onInteractionAction,
        persistedDraft: undefined,
        writeDraft: vi.fn(),
      }),
    );

    act(() => hook.result.current.handleToggle(twoQuestionArgs.questions[0], 'Full'));
    act(() => hook.result.current.setSupplementMode(true));
    act(() => hook.result.current.handleSupplementTextChange('Keep this timeout note.'));
    act(() => hook.result.current.setQuestionMode('1'));
    act(() => vi.advanceTimersByTime(1000));

    expect(onInteractionAction).toHaveBeenCalledExactlyOnceWith({
      payload: {
        'How broad?': 'Full',
        'Which mode?': 'Auto',
        '__supplement__': 'Keep this timeout note.',
      },
      type: 'submit',
    });

    hook.unmount();
    vi.useRealTimers();
  });
});
