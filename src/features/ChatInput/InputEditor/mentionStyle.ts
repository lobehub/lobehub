import styles from './mentionStyle.module.css';

// Class that drops the default chip style of `@lobehub/editor`'s mention plugin, so
// @-mentions render as plain colored text (see `mentionStyle.module.css`).
export const mentionPlainClassName: string = styles.mentionPlain;
