'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { BookOpenIcon } from 'lucide-react';
import { type ComponentType, memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConnectorPageId } from './connectorPage';
import RepositoryAccess from './Github/RepositoryAccess';
import WorkspaceAccess from './Linear/WorkspaceAccess';

const styles = stylex.create({
  docs: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    display: 'inline-flex',
    gap: '6px',
  },
});

const CONTENT: Record<
  ConnectorPageId,
  { Access: ComponentType; docsLabel: 'github.info.docsLink' | 'linear.docsLink'; docsUrl: string }
> = {
  github: {
    Access: RepositoryAccess,
    docsLabel: 'github.info.docsLink',
    docsUrl: 'https://lobehub.com/docs/usage/integrations/github',
  },
  linear: {
    Access: WorkspaceAccess,
    docsLabel: 'linear.docsLink',
    docsUrl: 'https://lobehub.com/docs/usage/integrations/linear',
  },
};

/** The integration half of a connector page, and its guide. */
const ConnectorPageContent = memo<{ identifier: ConnectorPageId }>(({ identifier }) => {
  const { t } = useTranslation('integration');
  const { Access, docsLabel, docsUrl } = CONTENT[identifier];

  return (
    <Flexbox gap={16}>
      <Access />
      <a href={docsUrl} rel="noreferrer" target="_blank" {...stylex.props(styles.docs)}>
        <Icon icon={BookOpenIcon} size="small" />
        <Text style={{ color: 'inherit', fontSize: 13 }}>{t(docsLabel)}</Text>
      </a>
    </Flexbox>
  );
});

ConnectorPageContent.displayName = 'ConnectorPageContent';

export default ConnectorPageContent;
