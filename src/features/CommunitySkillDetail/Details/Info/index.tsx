'use client';

import { Block } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import { media } from '@lobehub/ui/stylex/media.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedTime from '@/components/PublishedTime';
import { useSkillCategoryItem } from '@/hooks/useSkillCategory';
import { formatNumber } from '@/utils/format';

import { useDetailContext } from '../../DetailProvider';
import { isGitHubUrl } from './isGitHubUrl';

const EMPTY_VALUE = '--';

const styles = stylex.create({
  card: {
    overflow: 'hidden',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  label: {
    fontSize: { default: '14px', [media.sm]: '13px' },
    fontWeight: 500,
    lineHeight: 1.35,
    color: cssVar.colorTextDescription,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(120px, 1fr) minmax(0, 2fr)',
      [media.sm]: '1fr',
    },
    gap: { default: null, [media.sm]: '6px' },
    alignItems: { default: 'center', [media.sm]: 'flex-start' },
    minHeight: { default: '58px', [media.sm]: '56px' },
    paddingBlock: { default: '0', [media.sm]: '14px' },
    paddingInline: { default: '24px', [media.sm]: '18px' },
    borderBlockEndWidth: { 'default': '1px', ':last-child': '0' },
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  sourceLink: {
    display: 'inline-flex',
    gap: '4px',
    alignItems: 'center',
    justifyContent: 'flex-end',
    color: { 'default': cssVar.colorLink, ':hover': cssVar.colorLinkHover },
  },
  value: {
    minWidth: 0,
    fontSize: '14px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.35,
    color: cssVar.colorText,
    textAlign: { default: 'end', [media.sm]: 'start' },
    wordBreak: 'break-word',
  },
  valueMuted: { color: cssVar.colorTextDescription },
});

const isEmptyValue = (value: ReactNode) => value === undefined || value === null || value === '';

const InfoRow = memo<{ label: ReactNode; value: ReactNode }>(({ label, value }) => {
  const empty = isEmptyValue(value);

  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <div {...stylex.props(styles.value, empty && styles.valueMuted)}>
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
    <a
      {...stylex.props(styles.sourceLink)}
      href={sourceUrl}
      rel={'noopener noreferrer'}
      target={'_blank'}
    >
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
    <Block
      className={stylex.props(styles.card).className}
      paddingBlock={0}
      paddingInline={0}
      variant={'outlined'}
    >
      {rows.map((row) => (
        <InfoRow key={row.key} label={row.label} value={row.value} />
      ))}
    </Block>
  );
});

export default Info;
