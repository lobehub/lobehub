'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AnchorIcon, LayersIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

const styles = createStaticStyles(({ css }) => ({
  item: css`
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
  `,
  seq: css`
    padding-block-start: 2px;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
  `,
}));

/**
 * 它的锚 —— 这个方向是拿什么标准在学：什么算实践、对照哪些经典原则、分成哪几层。
 * 建域时定下来的东西，在详情里必须看得见；否则画像里的「层」和「覆盖」都无从解释。
 */
const AnchorCard = memo<{ domain: ExpertiseDomainItem }>(({ domain }) => {
  const { t } = useTranslation('selfLearning');
  return (
    <Block padding={'12px 14px'} variant={'outlined'}>
      <Flexbox gap={14}>
        <Flexbox gap={6}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon color={cssVar.colorTextTertiary} icon={AnchorIcon} size={15} />
            <Text weight={600}>{t('anchor.title')}</Text>
          </Flexbox>
          <Text fontSize={13}>
            <Text fontSize={13} type={'secondary'}>
              {t('anchor.filter')}
            </Text>
            {domain.domainFilter}
          </Text>
          {domain.outOfScope && (
            <Text fontSize={13}>
              <Text fontSize={13} type={'secondary'}>
                {t('anchor.outOfScope')}
              </Text>
              {domain.outOfScope}
            </Text>
          )}
        </Flexbox>

        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Text fontSize={13} weight={600}>
              {t('create.anchor.canon')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {domain.canonEntries.length > 0 ? t('create.anchor.canonHint') : t('anchor.noCanon')}
            </Text>
          </Flexbox>
          {domain.canonEntries.map((c, i) => (
            <div className={styles.item} key={c.key}>
              <span className={styles.seq}>C{i + 1}</span>
              <Flexbox gap={2}>
                <Flexbox horizontal align={'baseline'} gap={8} wrap={'wrap'}>
                  <Text fontSize={13} weight={500}>
                    {c.title}
                  </Text>
                  <Text fontSize={12} type={'secondary'}>
                    {c.source}
                  </Text>
                </Flexbox>
                <Text fontSize={12.5} type={'secondary'}>
                  {c.statement}
                </Text>
              </Flexbox>
            </div>
          ))}
        </Flexbox>

        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon color={cssVar.colorTextTertiary} icon={LayersIcon} size={14} />
            <Text fontSize={13} weight={600}>
              {t('create.anchor.layers')}
            </Text>
            <Text fontSize={12} type={'secondary'}>
              {domain.layers.length === 0
                ? t('anchor.noLayers')
                : domain.layerSource === 'canonical' && domain.layerCanonRef
                  ? t('create.anchor.layersFrom', { ref: domain.layerCanonRef })
                  : t('create.anchor.layersInvented')}
            </Text>
          </Flexbox>
          {domain.layers.map((l, i) => (
            <div className={styles.item} key={l.key}>
              <span className={styles.seq}>L{i + 1}</span>
              <Flexbox horizontal align={'baseline'} gap={8} wrap={'wrap'}>
                <Text fontSize={13} weight={500}>
                  {l.title}
                </Text>
                {l.description && (
                  <Text fontSize={12.5} type={'secondary'}>
                    {l.description}
                  </Text>
                )}
              </Flexbox>
            </div>
          ))}
        </Flexbox>
      </Flexbox>
    </Block>
  );
});

AnchorCard.displayName = 'ExpertiseAnchorCard';

export default AnchorCard;
