'use client';

import { Flexbox, Icon, Text, Typography } from '@lobehub/ui';
import { ExternalLink } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from './DetailContext';
import { styles } from './styles';

const Overview = memo(() => {
  const { t } = useTranslation(['plugin']);
  const { author, authorUrl, localizedReadme } = useDetailContext();

  const handleAuthorClick = () => {
    if (authorUrl) {
      window.open(authorUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Flexbox gap={20}>
      {/* Introduction */}
      <Typography className={styles.introduction}>{localizedReadme}</Typography>

      {/* Developed by */}
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={4}>
          <span className={styles.sectionTitle}>{t('skillDetail.developedBy')}</span>
          <span
            className={styles.authorLink}
            style={{ cursor: authorUrl ? 'pointer' : 'default' }}
            onClick={handleAuthorClick}
          >
            {author}
            {authorUrl && <Icon icon={ExternalLink} size={12} />}
          </span>
        </Flexbox>
        <Text className={styles.trustWarning} type="secondary">
          {t('skillDetail.trustWarning')}
        </Text>
      </Flexbox>

      {/* Details */}
      <Flexbox gap={12}>
        <span className={styles.sectionTitle}>{t('skillDetail.details')}</span>
        <Flexbox horizontal gap={16}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>{t('skillDetail.author')}</span>
            <span
              className={styles.authorLink}
              style={{ cursor: authorUrl ? 'pointer' : 'default' }}
              onClick={handleAuthorClick}
            >
              {author}
              {authorUrl && <Icon icon={ExternalLink} size={12} />}
            </span>
          </div>
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
});

export default Overview;
