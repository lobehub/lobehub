'use client';

import { Button, createModal, Flexbox, Input, useModalContext } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useLinkPullRequestField } from './useLinkPullRequestField';

const styles = stylex.create({
  error: { fontSize: '12px', color: cssVar.colorError },
});

interface LinkPullRequestContentProps {
  /** Resolves to the linked `owner/repo#n`. */
  onLink: (url: string) => Promise<string | undefined>;
}

const LinkPullRequestContent = memo<LinkPullRequestContentProps>(({ onLink }) => {
  const { t: tChat } = useTranslation('chat');
  const { t: tCommon } = useTranslation('common');
  const { close } = useModalContext();
  const field = useLinkPullRequestField(onLink, close);

  return (
    <Flexbox gap={16}>
      <Flexbox gap={6}>
        <Input
          autoFocus
          aria-invalid={field.invalid || undefined}
          aria-label={tChat('workingPanel.overview.pr.link')}
          disabled={field.linking}
          placeholder={tChat('workingPanel.overview.pr.linkPlaceholder')}
          value={field.value}
          onChange={(event) => field.change(event.target.value)}
          onPressEnter={() => void field.submit()}
        />
        {field.invalid && (
          <div role={'alert'} {...stylex.props(styles.error)}>
            {tChat('workingPanel.overview.pr.linkInvalid')}
          </div>
        )}
      </Flexbox>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button disabled={field.linking} onClick={close}>
          {tCommon('cancel')}
        </Button>
        <Button
          disabled={!field.value.trim()}
          loading={field.linking}
          type={'primary'}
          onClick={() => void field.submit()}
        >
          {tChat('workingPanel.overview.pr.linkAction')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

LinkPullRequestContent.displayName = 'LinkPullRequestContent';

/**
 * Better Coding Experience: link a PR the agent's commands never touched by
 * pasting its GitHub URL.
 */
export const openLinkPullRequestModal = (onLink: LinkPullRequestContentProps['onLink']) =>
  createModal({
    content: <LinkPullRequestContent onLink={onLink} />,
    footer: null,
    title: t('workingPanel.overview.pr.link', { ns: 'chat' }),
    width: 440,
  });
