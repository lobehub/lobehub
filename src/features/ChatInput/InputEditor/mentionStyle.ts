// oxlint-disable-next-line stylex-migration/no-plain-css -- the mention spans are Lexical decorator nodes @lobehub/editor's mention plugin renders inside editor content, with no className or style prop for them
import './mentionStyle.css';

// Class that drops the default chip style of `@lobehub/editor`'s mention plugin, so
// @-mentions render as plain colored text (see `mentionStyle.css`).
export const mentionPlainClassName: string = 'lobe-mention-style-3304531e-mention-plain';
