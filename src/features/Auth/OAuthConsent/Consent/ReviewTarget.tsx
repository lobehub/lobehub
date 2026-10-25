import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReviewTargetInput, reviewTargetView } from './reviewTargetView';

const styles = stylex.create({
  origin: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: 12,
    wordBreak: 'break-all',
  },
});

const blockStyle = { marginBottom: 16 };

const ReviewTarget = memo<{ review: ReviewTargetInput }>(({ review }) => {
  const { t } = useTranslation('oauth');
  const view = reviewTargetView(review);

  switch (view.kind) {
    case 'acceptance': {
      return (
        <Block padding={16} style={blockStyle} variant={'outlined'}>
          <Text type={view.denied ? 'danger' : undefined} weight={500}>
            {view.denied
              ? t('consent.acceptanceReview.denied')
              : t('consent.acceptanceReview.target', { title: view.title })}
          </Text>
        </Block>
      );
    }
    case 'siteDenied': {
      return (
        <Block padding={16} style={blockStyle} variant={'outlined'}>
          <Text type={'danger'} weight={500}>
            {t('consent.acceptanceReview.siteDenied')}
          </Text>
        </Block>
      );
    }
    case 'unregistered': {
      return (
        <Block gap={8} padding={16} style={blockStyle} variant={'outlined'}>
          <Text type={'danger'} weight={500}>
            {t('consent.acceptanceReview.unregisteredTitle')}
          </Text>
          {view.origin && (
            <Text {...stylex.props(styles.origin)} type={'danger'}>
              {view.origin}
            </Text>
          )}
          <Text fontSize={13} type={'secondary'}>
            {t('consent.acceptanceReview.unregisteredHint')}
          </Text>
        </Block>
      );
    }
    case 'site': {
      return (
        <Block gap={6} padding={16} style={blockStyle} variant={'outlined'}>
          <Text weight={500}>{t('consent.acceptanceReview.siteTarget', { site: view.site })}</Text>
          <Text fontSize={13} type={'secondary'}>
            {view.role
              ? t('consent.acceptanceReview.siteProjectRole', {
                  project: view.project,
                  role: t(`consent.acceptanceReview.role.${view.role}`),
                })
              : t('consent.acceptanceReview.siteProject', { project: view.project })}
          </Text>
          {view.origin && (
            <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
              <Text {...stylex.props(styles.origin)} type={'secondary'}>
                {view.origin}
              </Text>
              <Text fontSize={12} type={'success'}>
                {t('consent.acceptanceReview.registered')}
              </Text>
            </Flexbox>
          )}
        </Block>
      );
    }
  }
});

ReviewTarget.displayName = 'ReviewTarget';

export default ReviewTarget;
