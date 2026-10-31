import { Github } from '@lobehub/icons';
import { Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';

import {
  safeScmUrl,
  type ScmEventAttributes,
  scmEventTitle,
} from '@/features/Conversation/Markdown/plugins/ScmEvent/parseScmEvent';

const styles = stylex.create({
  link: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    color: { 'default': 'inherit', ':hover': cssVar.colorTextSecondary },
  },
  mark: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '36px',
    blockSize: '36px',
    borderRadius: '8px',
    color: cssVar.colorText,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  mono: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px' },
});

/** GitHub mark standing in for the avatar of a wake-up message. */
export const ScmEventAvatar = memo(() => (
  <span {...stylex.props(styles.mark)}>
    <Github size={20} />
  </span>
));

ScmEventAvatar.displayName = 'ScmEventAvatar';

/**
 * The pull request as the sender name of a wake-up message: `owner/repo #n`
 * linking to it, with the branch and commit it is about on a second line —
 * sized to sit beside the two-line-tall GitHub mark.
 */
export const ScmEventSenderTitle = memo<{ source: ScmEventAttributes }>(({ source }) => {
  const title = scmEventTitle(source);
  const subtitle = [source.branch, source.sha].filter(Boolean).join(' @ ');
  // The url is a tag attribute, so it skips the parser's guard.
  const url = safeScmUrl(source.url);

  return (
    <Flexbox align={'flex-end'} gap={2} style={{ minWidth: 0 }}>
      <Text style={{ whiteSpace: 'nowrap' }} weight={500}>
        {url ? (
          <a {...stylex.props(styles.link)} href={url} rel="noreferrer" target="_blank">
            {title}
          </a>
        ) : (
          title
        )}
      </Text>
      {subtitle ? (
        <Text ellipsis className={stylex.props(styles.mono).className} type={'secondary'}>
          {subtitle}
        </Text>
      ) : null}
    </Flexbox>
  );
});

ScmEventSenderTitle.displayName = 'ScmEventSenderTitle';
