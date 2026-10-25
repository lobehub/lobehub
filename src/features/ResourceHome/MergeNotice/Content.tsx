'use client';

import { Button, Flexbox, Icon, Text, useModalContext } from '@lobehub/ui';
import {
  FileTextIcon,
  HardDriveIcon,
  LibraryBigIcon,
  Link2Icon,
  type LucideIcon,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface PointProps {
  desc: string;
  icon: LucideIcon;
  title: string;
}

const Point = memo<PointProps>(({ desc, icon, title }) => (
  <Flexbox horizontal align={'flex-start'} gap={12}>
    <Icon icon={icon} size={18} style={{ flex: 'none', marginBlockStart: 2 }} />
    <Flexbox gap={2}>
      <Text weight={500}>{title}</Text>
      <Text fontSize={13} type={'secondary'}>
        {desc}
      </Text>
    </Flexbox>
  </Flexbox>
));

Point.displayName = 'DocsMergePoint';

/** Where things moved when Pages and Resources became Docs. */
export const DocsMergeNoticeContent = memo(() => {
  const { t } = useTranslation('file');
  const { close } = useModalContext();

  return (
    <Flexbox gap={20}>
      <Text type={'secondary'}>{t('docs.mergeNotice.intro')}</Text>
      <Flexbox gap={14}>
        <Point
          desc={t('docs.mergeNotice.pages.desc')}
          icon={FileTextIcon}
          title={t('docs.mergeNotice.pages.title')}
        />
        <Point
          desc={t('docs.mergeNotice.drive.desc')}
          icon={HardDriveIcon}
          title={t('docs.mergeNotice.drive.title')}
        />
        <Point
          desc={t('docs.mergeNotice.knowledgeBase.desc')}
          icon={LibraryBigIcon}
          title={t('docs.mergeNotice.knowledgeBase.title')}
        />
        <Point
          desc={t('docs.mergeNotice.links.desc')}
          icon={Link2Icon}
          title={t('docs.mergeNotice.links.title')}
        />
      </Flexbox>
      <Flexbox horizontal justify={'flex-end'}>
        <Button type={'primary'} onClick={() => close()}>
          {t('docs.mergeNotice.confirm')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

DocsMergeNoticeContent.displayName = 'DocsMergeNoticeContent';
