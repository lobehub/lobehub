'use client';

import { Accordion, Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { AnchorIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExpertiseDomainItem } from '@/services/expertise';

const styles = stylex.create({
  anchorCard: { overflow: 'hidden' },
  anchorContent: { paddingBlockStart: '8px', paddingBlockEnd: '16px', paddingInline: '16px' },
  anchorHeader: {
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  canonCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minWidth: '0',
    paddingBlock: '12px',
    paddingInline: '14px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  definition: {
    display: 'grid',
    gridTemplateColumns: '110px minmax(0, 1fr)',
    rowGap: '10px',
    columnGap: '24px',
    alignItems: 'baseline',
  },
  definitionLabel: { display: 'inline-flex', gap: '6px', alignItems: 'center' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '10px',
  },
  layerCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: '0',
    paddingInlineStart: '12px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorBorderSecondary,
  },
  layerIndex: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextQuaternary,
    letterSpacing: '0.04em',
  },
  sectionLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: cssVar.colorTextSecondary,
    letterSpacing: '0.02em',
  },
});

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
    <Block className={stylex.props(styles.anchorCard).className} variant={'outlined'}>
      <Accordion
        classNames={{ header: stylex.props(styles.anchorHeader).className }}
        defaultValue={['anchor']}
        indicatorPlacement={'end'}
        styles={{ trigger: { paddingBlock: 12, paddingInline: 16 } }}
        variant={'borderless'}
        items={[
          {
            key: 'anchor',
            title,
            children: (
              <Flexbox className={stylex.props(styles.anchorContent).className} gap={24}>
                {(domainFilter || outOfScope) && (
                  <div {...stylex.props(styles.definition)}>
                    {domainFilter && (
                      <>
                        <Text
                          className={stylex.props(styles.definitionLabel).className}
                          fontSize={12.5}
                          type={'secondary'}
                        >
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
                        <Text
                          className={stylex.props(styles.definitionLabel).className}
                          fontSize={12.5}
                          type={'secondary'}
                        >
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
                    <span {...stylex.props(styles.sectionLabel)}>{t('create.anchor.canon')}</span>
                    <Text fontSize={12} type={'secondary'}>
                      {domain.canonEntries.length > 0
                        ? t('create.anchor.canonHint')
                        : t('anchor.noCanon')}
                    </Text>
                  </Flexbox>
                  {domain.canonEntries.length > 0 && (
                    <div {...stylex.props(styles.grid)}>
                      {domain.canonEntries.map((c) => (
                        <div {...stylex.props(styles.canonCard)} key={c.key}>
                          <Text fontSize={13.5} weight={600}>
                            {c.title}
                          </Text>
                          <Text fontSize={12.5} lineHeight={1.65} type={'secondary'}>
                            {c.statement}
                          </Text>
                          <Text
                            ellipsis
                            fontSize={11.5}
                            style={{ opacity: 0.75 }}
                            type={'secondary'}
                          >
                            — {c.source}
                          </Text>
                        </div>
                      ))}
                    </div>
                  )}
                </Flexbox>

                <Flexbox gap={10}>
                  <Flexbox horizontal align={'baseline'} gap={8}>
                    <span {...stylex.props(styles.sectionLabel)}>{t('create.anchor.layers')}</span>
                    <Text fontSize={12} type={'secondary'}>
                      {domain.layers.length === 0
                        ? t('anchor.noLayers')
                        : canonRef
                          ? t('create.anchor.layersFrom', { ref: canonRef })
                          : t('create.anchor.layersInvented')}
                    </Text>
                  </Flexbox>
                  {domain.layers.length > 0 && (
                    <div {...stylex.props(styles.grid)}>
                      {domain.layers.map((l, i) => (
                        <div {...stylex.props(styles.layerCell)} key={l.key}>
                          <span {...stylex.props(styles.layerIndex)}>L{i + 1}</span>
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
            ),
          },
        ]}
      />
    </Block>
  );
});

AnchorCard.displayName = 'ExpertiseAnchorCard';

export default AnchorCard;
