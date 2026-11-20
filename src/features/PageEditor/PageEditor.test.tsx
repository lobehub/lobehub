import { describe, expect, it } from 'vitest';

import { getTitleTextAreaInteractionProps, isTitleSubmitKey } from './TitleSection';

describe('PageEditor title interaction', () => {
  it('keeps a non-editable title visually enabled but read-only', () => {
    const props = getTitleTextAreaInteractionProps(false);

    expect(props).toEqual({ readOnly: true });
    expect(props).not.toHaveProperty('disabled');
    expect(getTitleTextAreaInteractionProps(true)).toEqual({ readOnly: false });
  });

  it('submits the title on a plain Enter', () => {
    expect(
      isTitleSubmitKey({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: false } }),
    ).toBe(true);
    expect(isTitleSubmitKey({ key: 'a', keyCode: 65, nativeEvent: { isComposing: false } })).toBe(
      false,
    );
  });

  it('ignores Enter that confirms an IME composition', () => {
    expect(
      isTitleSubmitKey({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: true } }),
    ).toBe(false);
    // Safari fires the confirming keydown after compositionend with keyCode 229
    expect(
      isTitleSubmitKey({ key: 'Enter', keyCode: 229, nativeEvent: { isComposing: false } }),
    ).toBe(false);
  });
});
