import { Github } from '@lobehub/icons';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import {
  safeScmUrl,
  type ScmEventAttributes,
  scmEventTitle,
} from '@/features/Conversation/Markdown/plugins/ScmEvent/parseScmEvent';

const styles = createStaticStyles(({ css, cssVar }) => ({
  link: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    color: inherit;

    &:hover {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  mark: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    inline-size: 36px;
    block-size: 36px;
    border-radius: 8px;

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
}));

/** GitHub mark standing in for the avatar of a wake-up message. */
export const ScmEventAvatar = memo(() => (
  <span className={styles.mark}>
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
          <a className={styles.link} href={url} rel="noreferrer" target="_blank">
            {title}
          </a>
        ) : (
          title
        )}
      </Text>
      {subtitle ? (
        <Text ellipsis className={styles.mono} type={'secondary'}>
          {subtitle}
        </Text>
      ) : null}
    </Flexbox>
  );
});

ScmEventSenderTitle.displayName = 'ScmEventSenderTitle';
