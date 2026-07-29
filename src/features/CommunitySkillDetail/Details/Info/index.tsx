'use client';

import { Block } from '@lobehub/ui';
import { createStaticStyles, responsive } from 'antd-style';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import { useSkillCategoryItem } from '@/hooks/useSkillCategory';
import { formatNumber } from '@/utils/format';

import { useDetailContext } from '../../DetailProvider';
import { isGitHubUrl } from './isGitHubUrl';

const EMPTY_VALUE = '--';

const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    overflow: hidden;
    border-color: ${cssVar.colorBorderSecondary} !important;
    border-radius: 16px !important;
    background: ${cssVar.colorBgContainer} !important;
  `,
  label: css`
    font-size: 14px;
    font-weight: 500;
    line-height: 1.35;
    color: ${cssVar.colorTextDescription};

    ${responsive.sm} {
      font-size: 13px;
    }
  `,
  row: css`
    display: grid;
    grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr);
    align-items: center;

    min-height: 58px;
    padding-block: 0;
    padding-inline: 24px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: 0;
    }

    ${responsive.sm} {
      grid-template-columns: 1fr;
      gap: 6px;
      align-items: flex-start;

      min-height: 56px;
      padding-block: 14px;
      padding-inline: 18px;
    }
  `,
  sourceLink: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    justify-content: flex-end;

    color: ${cssVar.colorLink};

    &:hover {
      color: ${cssVar.colorLinkHover};
    }
  `,
  value: css`
    min-width: 0;

    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.35;
    color: ${cssVar.colorText};
    text-align: end;
    word-break: break-word;

    ${responsive.sm} {
      text-align: start;
    }
  `,
  valueMuted: css`
    color: ${cssVar.colorTextDescription};
  `,
}));

const isEmptyValue = (value: ReactNode) => value === undefined || value === null || value === '';

const InfoRow = memo<{ label: ReactNode; value: ReactNode }>(({ label, value }) => {
  const empty = isEmptyValue(value);

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={[styles.value, empty ? styles.valueMuted : ''].filter(Boolean).join(' ')}>
        {empty ? EMPTY_VALUE : value}
      </div>
    </div>
  );
});

const Info = memo(() => {
  const { t } = useTranslation('discover');
  const {
    author,
    category,
    createdAt,
    github,
    homepage,
    installCount,
    license,
    repository,
    updatedAt,
    version,
    versions = [],
  } = useDetailContext();

  const categoryItem = useSkillCategoryItem(category);
  // Honor the fetched (possibly deep-linked ?version=) version before falling
  // back to the latest entry
  const selectedVersion =
    versions.find((item) => item.version === version) ||
    versions.find((item) => item.isLatest) ||
    versions[0];
  const sourceUrl = github?.url || repository || homepage;
  const isGitHubSource = isGitHubUrl(sourceUrl);
  const updatedDate = selectedVersion?.createdAt || updatedAt || createdAt;

  const sourceValue = sourceUrl ? (
    <a className={styles.sourceLink} href={sourceUrl} rel={'noopener noreferrer'} target={'_blank'}>
      {isGitHubSource ? t('skills.details.info.viewOnGithub') : t('skills.details.info.viewSource')}{' '}
      ↗
    </a>
  ) : undefined;

  const rows: { key: string; label: ReactNode; value: ReactNode }[] = [
    {
      key: 'publisher',
      label: t('skills.details.info.publisher'),
      value: author?.name,
    },
    {
      key: 'category',
      label: t('skills.details.info.category'),
      value: categoryItem?.label || category,
    },
    {
      key: 'version',
      label: t('skills.details.info.version'),
      value: version || selectedVersion?.version,
    },
    {
      key: 'updated',
      label: t('skills.details.info.updated'),
      value: updatedDate ? (
        <PublishedTime
          date={updatedDate as string}
          style={{ color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', marginBlock: 0 }}
          template={'MMM DD, YYYY'}
        />
      ) : undefined,
    },
    {
      key: 'license',
      label: t('skills.details.info.license'),
      value: license?.name ? (
        license.url ? (
          <a
            href={license.url}
            rel={'noopener noreferrer'}
            style={{ color: 'inherit', textDecoration: 'none' }}
            target={'_blank'}
          >
            {license.name}
          </a>
        ) : (
          license.name
        )
      ) : undefined,
    },
    {
      key: 'installs',
      label: t('skills.details.info.installs'),
      value: typeof installCount === 'number' ? formatNumber(installCount) : undefined,
    },
    {
      key: 'stars',
      label: t('skills.details.info.stars'),
      value: typeof github?.stars === 'number' ? formatNumber(github.stars) : undefined,
    },
    {
      key: 'source',
      label: t('skills.details.info.source'),
      value: sourceValue,
    },
  ];

  return (
    <Block className={styles.card} paddingBlock={0} paddingInline={0} variant={'outlined'}>
      {rows.map((row) => (
        <InfoRow key={row.key} label={row.label} value={row.value} />
      ))}
    </Block>
  );
});

export default Info;
