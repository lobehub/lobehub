import { Input } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { LinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { OverviewRow } from './OverviewRow';
import { useLinkPullRequestField } from './useLinkPullRequestField';

const styles = stylex.create({
  editor: { paddingBlock: '4px', paddingInline: '8px' },
  error: { marginBlockStart: '4px', fontSize: '12px', color: cssVar.colorError },
});

interface LinkPullRequestRowProps {
  /** Resolves to the linked `owner/repo#n`. */
  onLink: (url: string) => Promise<string | undefined>;
}

/**
 * Better Coding Experience: link a PR the agent's commands never touched by
 * pasting its URL. A row first, so the repository card stays quiet; the field
 * opens in place.
 */
const LinkPullRequestRow = memo<LinkPullRequestRowProps>(({ onLink }) => {
  const { t } = useTranslation('chat');
  const field = useLinkPullRequestField(onLink);

  if (!field.editing)
    return (
      <OverviewRow
        weak
        icon={LinkIcon}
        iconSize={14}
        value={t('workingPanel.overview.pr.link')}
        onClick={field.open}
      />
    );

  return (
    <div {...stylex.props(styles.editor)}>
      <Input
        autoFocus
        aria-invalid={field.invalid || undefined}
        aria-label={t('workingPanel.overview.pr.link')}
        disabled={field.linking}
        placeholder={t('workingPanel.overview.pr.linkPlaceholder')}
        size={'small'}
        value={field.value}
        onChange={(event) => field.change(event.target.value)}
        onBlur={() => {
          if (!field.value.trim()) field.close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') field.close();
          if (event.key === 'Enter') void field.submit();
        }}
      />
      {field.invalid && (
        <div role={'alert'} {...stylex.props(styles.error)}>
          {t('workingPanel.overview.pr.linkInvalid')}
        </div>
      )}
    </div>
  );
});

LinkPullRequestRow.displayName = 'OverviewLinkPullRequestRow';

export default LinkPullRequestRow;
