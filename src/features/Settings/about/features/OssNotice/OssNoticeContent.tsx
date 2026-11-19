'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { cssVar, Divider, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { SquareArrowOutUpRight } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { OSS_COMPONENTS, type OssComponent, type OssGroup } from './data';

const GROUPS: OssGroup[] = ['desktop', 'runtime'];

const OssNoticeRow = ({ item }: { item: OssComponent }) => {
  const { t } = useTranslation('common');

  return (
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} paddingBlock={10}>
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text weight={500}>{item.name}</Text>
        {item.noteKey && (
          <Text fontSize={12} type={'secondary'}>
            {t(item.noteKey)}
          </Text>
        )}
      </Flexbox>
      <Flexbox horizontal align={'center'} flex={'none'} gap={12}>
        <Tag>{item.license}</Tag>
        <a
          aria-label={t('openSourceNotice.viewLicenseAria', { name: item.name })}
          href={item.url}
          rel={'noreferrer noopener'}
          style={{ color: 'inherit', whiteSpace: 'nowrap' }}
          target={'_blank'}
        >
          <Flexbox horizontal align={'center'} gap={4}>
            {t('openSourceNotice.viewLicense')}
            <Icon color={cssVar.colorTextDescription} icon={SquareArrowOutUpRight} size={14} />
          </Flexbox>
        </a>
      </Flexbox>
    </Flexbox>
  );
};

const OssNoticeContent = () => {
  const { t } = useTranslation('common');

  return (
    <Flexbox gap={20} style={{ maxHeight: '60vh', overflowY: 'auto' }}>
      <Text type={'secondary'}>{t('openSourceNotice.desc', { appName: BRANDING_NAME })}</Text>
      {GROUPS.map((group) => (
        <Flexbox gap={4} key={group}>
          <Text type={'secondary'} weight={'bold'}>
            {t(`openSourceNotice.group.${group}`)}
          </Text>
          {OSS_COMPONENTS.filter((item) => item.group === group).map((item, index) => (
            <Fragment key={item.name}>
              {index > 0 && <Divider style={{ marginBlock: 0 }} />}
              <OssNoticeRow item={item} />
            </Fragment>
          ))}
        </Flexbox>
      ))}
    </Flexbox>
  );
};

export default OssNoticeContent;
