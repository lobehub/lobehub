// oxlint-disable-next-line stylex-migration/no-emotion-styles -- @lobehub/editor mention spans take no className
import { createStaticStyles } from '@lobehub/ui';

const fallback = createStaticStyles(({ css }) => ({
  mentionPlain: css`
    span:has(> .editor_mention),
    .editor_mention {
      border: none;
    }

    span:has(> .editor_mention):not(.selected) {
      background: none;
    }
  `,
}));

export const mentionPlainClassName: string = fallback.mentionPlain;
