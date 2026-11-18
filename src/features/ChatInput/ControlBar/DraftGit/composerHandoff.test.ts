import { describe, expect, it } from 'vitest';

import { resolveComposerHandoff } from './composerHandoff';

describe('resolveComposerHandoff', () => {
  it('clears as before when the send waited on no git step', () => {
    expect(
      resolveComposerHandoff({ acted: false, editorUnchanged: false, stillHere: false }),
    ).toEqual({ clearEditor: true, sendToOrigin: false });
  });

  it('clears the draft that was sent from the same conversation', () => {
    expect(resolveComposerHandoff({ acted: true, editorUnchanged: true, stillHere: true })).toEqual(
      { clearEditor: true, sendToOrigin: false },
    );
  });

  it('keeps text typed while git ran', () => {
    expect(
      resolveComposerHandoff({ acted: true, editorUnchanged: false, stillHere: true }).clearEditor,
    ).toBe(false);
  });

  it('sends to the original conversation and leaves the one now open alone', () => {
    expect(
      resolveComposerHandoff({ acted: true, editorUnchanged: true, stillHere: false }),
    ).toEqual({ clearEditor: false, sendToOrigin: true });
  });
});
