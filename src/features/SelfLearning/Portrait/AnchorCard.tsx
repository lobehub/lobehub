'use client';

import { Accordion, AccordionItem, Block, Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AnchorIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

const styles = createStaticStyles(({ css }) => ({
  anchorCard: css`
    overflow: hidden;
  `,
  anchorContent: css`
    padding-block: 8px 16px;
    padding-inline: 16px;
  `,
  anchorHeader: css`
    &:hover {
      background: transparent;
    }
  `,
  canonCard: css`
    display: flex;
    flex-direction: column;
    gap: 6px;

    min-width: 0;
    padding-block: 12px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  definition: css`
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 10px 24px;
    align-items: baseline;
  `,
  definitionLabel: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  `,
  layerCell: css`
    display: flex;
    flex-direction: column;
    gap: 4px;

    min-width: 0;
    padding-inline-start: 12px;
    border-inline-start: 2px solid ${cssVar.colorBorderSecondary};
  `,
  layerIndex: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
    letter-spacing: 0.04em;
  `,
  sectionLabel: css`
    font-size: 12px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
    letter-spacing: 0.02em;
  `,
}));

/**
 * 它的锚 —— 这个方向拿什么标准在学：什么算实践、对照哪些经典原则、分成哪几层。
 * 建域时定下的东西，在详情里必须看得见；否则画像里的「层」和「覆盖」都无从解释。
 *
 * 排版：定义两行（标签列 + 正文）→ 经典依据卡片网格 → 分层横向条带。
 * 三块信息形态不同（句子 / 引文 / 层级），各用各的形状，不做成一列文字。
 */
const AnchorCard = memo<{ domain: ExpertiseDomainItem }>(({ domain }) => {
  const { t } = useTranslation('selfLearning');
  const canonRef =
    domain.layerSource === 'canonical' && domain.layerCanonRef ? domain.layerCanonRef : undefined;
  const domainFilter = domain.domainFilter.trim();
  const outOfScope = domain.outOfScope?.trim();
  const title = (
    <Flexbox horizontal align={'center'} gap={8}>
      <Icon color={cssVar.colorTextTertiary} icon={AnchorIcon} size={15} />
      <Text weight={600}>{t('anchor.title')}</Text>
      <Text fontSize={12} type={'secondary'}>
        {t('anchor.subtitle')}
      </Text>
    </Flexbox>
  );

  return (
    <Block className={styles.anchorCard} variant={'outlined'}>
      <Accordion defaultExpandedKeys={['anchor']} indicatorPlacement={'end'} variant={'borderless'}>
        <AccordionItem
          classNames={{ header: styles.anchorHeader }}
          itemKey={'anchor'}
          paddingBlock={12}
          paddingInline={16}
          title={title}
        >
          <Flexbox className={styles.anchorContent} gap={24}>
            {(domainFilter || outOfScope) && (
              <div className={styles.definition}>
                {domainFilter && (
                  <>
                    <Text className={styles.definitionLabel} fontSize={12.5} type={'secondary'}>
                      <Icon color={cssVar.colorSuccess} icon={CircleCheckIcon} size={13} />
                      {t('anchor.filter')}
                    </Text>
                    <Text fontSize={13} lineHeight={1.7}>
                      {domainFilter}
                    </Text>
                  </>
                )}
                {outOfScope && (
                  <>
                    <Text className={styles.definitionLabel} fontSize={12.5} type={'secondary'}>
                      <Icon color={cssVar.colorTextTertiary} icon={CircleXIcon} size={13} />
                      {t('anchor.outOfScope')}
                    </Text>
                    <Text fontSize={13} lineHeight={1.7} type={'secondary'}>
                      {outOfScope}
                    </Text>
                  </>
                )}
              </div>
            )}

            <Flexbox gap={10}>
              <Flexbox horizontal align={'baseline'} gap={8}>
                <span className={styles.sectionLabel}>{t('create.anchor.canon')}</span>
                <Text fontSize={12} type={'secondary'}>
                  {domain.canonEntries.length > 0
                    ? t('create.anchor.canonHint')
                    : t('anchor.noCanon')}
                </Text>
              </Flexbox>
              {domain.canonEntries.length > 0 && (
                <div className={styles.grid}>
                  {domain.canonEntries.map((c) => (
                    <div className={styles.canonCard} key={c.key}>
                      <Text fontSize={13.5} weight={600}>
                        {c.title}
                      </Text>
                      <Text fontSize={12.5} lineHeight={1.65} type={'secondary'}>
                        {c.statement}
                      </Text>
                      <Text ellipsis fontSize={11.5} style={{ opacity: 0.75 }} type={'secondary'}>
                        — {c.source}
                      </Text>
                    </div>
                  ))}
                </div>
              )}
            </Flexbox>

            <Flexbox gap={10}>
              <Flexbox horizontal align={'baseline'} gap={8}>
                <span className={styles.sectionLabel}>{t('create.anchor.layers')}</span>
                <Text fontSize={12} type={'secondary'}>
                  {domain.layers.length === 0
                    ? t('anchor.noLayers')
                    : canonRef
                      ? t('create.anchor.layersFrom', { ref: canonRef })
                      : t('create.anchor.layersInvented')}
                </Text>
              </Flexbox>
              {domain.layers.length > 0 && (
                <div className={styles.grid}>
                  {domain.layers.map((l, i) => (
                    <div className={styles.layerCell} key={l.key}>
                      <span className={styles.layerIndex}>L{i + 1}</span>
                      <Text fontSize={13.5} weight={600}>
                        {l.title}
                      </Text>
                      {l.description && (
                        <Text fontSize={12.5} lineHeight={1.6} type={'secondary'}>
                          {l.description}
                        </Text>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Flexbox>
          </Flexbox>
        </AccordionItem>
      </Accordion>
    </Block>
  );
});

AnchorCard.displayName = 'ExpertiseAnchorCard';

export default AnchorCard;
