'use client';

import { createStaticStyles, Flexbox, Icon, Text } from '@lobehub/ui';
import { ArrowLeftIcon, BookOpenIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { GITHUB_INTEGRATION } from './definition';
import RepositoryAccess from './RepositoryAccess';

const styles = createStaticStyles(({ css, cssVar }) => ({
  back: css`
    cursor: pointer;

    display: inline-flex;
    gap: 6px;
    align-items: center;

    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  docs: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  hero: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};
  `,
}));

interface GithubIntegrationProps {
  onBack: () => void;
}

/**
 * The GitHub page on a deployment without LobeHub connectors, where the
 * Marketplace has no GitHub entry to host the App's settings.
 */
const GithubIntegration = memo<GithubIntegrationProps>(({ onBack }) => {
  const { t } = useTranslation('integration');
  const BrandIcon = GITHUB_INTEGRATION.icon;

  return (
    <Flexbox gap={24}>
      <span className={styles.back} onClick={onBack}>
        <Icon icon={ArrowLeftIcon} size="small" />
        <Text type="secondary">{t('overview.title')}</Text>
      </span>

      <Flexbox horizontal align="center" gap={16}>
        <span className={styles.hero}>
          <BrandIcon size={32} />
        </span>
        <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 20 }}>
            {GITHUB_INTEGRATION.name}
          </Text>
          <Text type="secondary">{t('github.tagline')}</Text>
        </Flexbox>
        <a
          className={styles.docs}
          href={GITHUB_INTEGRATION.docsUrl}
          rel="noreferrer"
          target="_blank"
        >
          <Icon icon={BookOpenIcon} size="small" />
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('github.info.docsLink')}
          </Text>
        </a>
      </Flexbox>

      <RepositoryAccess />
    </Flexbox>
  );
});

GithubIntegration.displayName = 'GithubIntegration';

export default GithubIntegration;
