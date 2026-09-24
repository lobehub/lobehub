import { css, cx } from 'antd-style';

// Override the default outlined chip style from `@lobehub/editor`'s mention
// plugin so @-mentions render as a flat filled chip, matching the look of
// other inline references (ActionMention, ReferTopic) in the chat UI.
// The outline lives on the Lexical decorator span (themed `mention` class),
// which wraps the inner `.editor_mention` span — so target the wrapper.
export const mentionFilledClassName = cx(css`
  span:has(> .editor_mention),
  .editor_mention {
    border: none;
  }
`);
