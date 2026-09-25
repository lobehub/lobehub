import { css, cx } from 'antd-style';

// Override the default chip style from `@lobehub/editor`'s mention plugin so
// @-mentions render as plain colored text, matching the look of other inline
// tags (skills, tools, commands) in the chat UI.
// The outline and fill live on the Lexical decorator span (themed `mention`
// class), which wraps the inner `.editor_mention` span — so target the
// wrapper. The yellow `.selected` highlight is kept so a mention picked for
// deletion stays visible.
export const mentionPlainClassName = cx(css`
  span:has(> .editor_mention),
  .editor_mention {
    border: none;
  }

  span:has(> .editor_mention):not(.selected) {
    background: none;
  }
`);
