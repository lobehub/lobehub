'use client';

import {
  Button,
  copyToClipboard,
  Flexbox,
  Popover,
  Tag,
  Text,
  toast,
  useResponsive,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Download, Share2 } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { ProductLogo } from '@/components/Branding';
import { isCustomBranding } from '@/const/version';

import { getLocalReport } from './localReportData';

const styles = stylex.create({
  command: {
    backgroundColor: cssVar.colorFillTertiary,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    overflowWrap: 'anywhere',
    paddingBlock: 6,
    paddingInline: 8,
  },
  divider: {
    backgroundColor: cssVar.colorBorderSecondary,
    flex: 'none',
    height: 16,
    width: 1,
  },
  share: {
    width: 320,
  },
  title: {
    flex: '1',
    minWidth: 0,
    overflow: 'hidden',
  },
});

/** `reviews.json` content, downloaded where the CLI looks for it. */
export const reviewExportFileName = (acceptanceId: string) =>
  `acceptance-reviews-${acceptanceId}.json`;

const download = (fileName: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * The page's own chrome: where the report lives, how many decisions are not
 * saved yet, and the one way out to collaboration.
 *
 * A file opened from disk cannot write next to itself, so "save" downloads the
 * review log; the CLI picks the newest download up on its next `view` or
 * `feedback` and files it beside the rounds.
 */
export const LocalReviewBar = () => {
  const { t } = useTranslation('verify');
  const { md = true } = useResponsive();
  const report = getLocalReport();
  useSyncExternalStore(report.subscribe, report.getVersion);
  const pending = report.pendingCount();
  const unsaved = report.unsavedCount();
  const title = report.bundle().subject.title;
  const publishCommand = `lh acceptance publish .acceptances/${report.source.acceptance.subjectKey}`;

  const save = () => {
    const fileName = reviewExportFileName(report.acceptanceId);
    download(fileName, `${JSON.stringify(report.exportLog(), null, 2)}\n`);
    report.markExported();
    toast.success(t('acceptance.local.saved', { file: fileName }));
  };

  return (
    <Flexbox horizontal align={'center'} gap={8} width={'100%'}>
      <ProductLogo size={22} type={isCustomBranding ? 'text' : 'flat'} />
      <div {...stylex.props(styles.divider)} />
      <Flexbox horizontal align={'center'} gap={8} {...stylex.props(styles.title)}>
        {/* A phone has room for the badge; the page heading names the delivery. */}
        {md && (
          <Text ellipsis strong style={{ minWidth: 0 }}>
            {title ?? t('acceptance.local.badge')}
          </Text>
        )}
        <Tag title={t('acceptance.local.badgeHint')}>{t('acceptance.local.badge')}</Tag>
      </Flexbox>
      {md && (
        <Text fontSize={12} type={'secondary'}>
          {unsaved > 0
            ? t('acceptance.local.unsaved', { count: unsaved })
            : pending > 0
              ? t('acceptance.local.downloaded')
              : report.source.reviews.length > 0
                ? t('acceptance.local.allSaved')
                : t('acceptance.local.noReviews')}
        </Text>
      )}
      <Popover
        placement={'bottomRight'}
        trigger={'click'}
        content={
          <Flexbox gap={8} {...stylex.props(styles.share)}>
            <Text strong>{t('acceptance.local.shareTitle')}</Text>
            <Text fontSize={12} type={'secondary'}>
              {t('acceptance.local.shareHint')}
            </Text>
            <div {...stylex.props(styles.command)}>{publishCommand}</div>
            <Button
              size={'small'}
              onClick={async () => {
                await copyToClipboard(publishCommand);
                toast.success(t('acceptance.local.copied'));
              }}
            >
              {t('acceptance.local.copy')}
            </Button>
          </Flexbox>
        }
      >
        <Button icon={Share2} title={t('acceptance.local.share')}>
          {md && t('acceptance.local.share')}
        </Button>
      </Popover>
      <Button
        disabled={pending === 0}
        icon={Download}
        title={t('acceptance.local.save')}
        type={'primary'}
        onClick={save}
      >
        {md ? t('acceptance.local.save') : unsaved > 0 ? unsaved : undefined}
      </Button>
    </Flexbox>
  );
};
