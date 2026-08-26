'use client';

import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { Progress } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import StreamingMarkdown from '@/components/StreamingMarkdown';

import type { IdentityMemoryViewModel } from './identityMemoryViewModel';
import { memoryCardStyles as styles, MemorySection, SummaryAccordion } from './MemoryCardParts';

const localStyles = createStaticStyles(({ css, cssVar }) => ({
  evidence: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-inline-start: 2px solid ${cssVar.colorBorder};

    font-size: 13px;
    font-style: italic;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export interface IdentityMemoryCardProps {
  data: IdentityMemoryViewModel;
  /** Header text when the memory has no title yet. */
  fallbackTitle?: string;
  loading?: boolean;
}

/**
 * Renders one identity fact. Shared by the add and update flows, which differ only
 * in the surrounding framing, not in how an identity itself reads.
 */
export const IdentityMemoryCard = memo<IdentityMemoryCardProps>(
  ({ data, fallbackTitle = 'Identity Memory', loading }) => {
    const {
      confidence,
      description,
      details,
      episodicDate,
      hasIdentityContent,
      identityType,
      isEmpty,
      labels,
      relationship,
      role,
      sourceEvidence,
      summary,
      tags,
      title,
    } = data;

    if (isEmpty) return null;

    return (
      <Flexbox className={styles.container}>
        <Flexbox horizontal align={'center'} className={styles.header} gap={8}>
          <Flexbox flex={1}>
            <div className={styles.title}>{title || fallbackTitle}</div>
          </Flexbox>
          {identityType && <Tag>{identityType}</Tag>}
          {relationship && <Tag color={'info'}>{relationship}</Tag>}
          {loading && <NeuralNetworkLoading size={20} />}
        </Flexbox>

        {hasIdentityContent ? (
          <>
            <SummaryAccordion details={details} summary={summary} tags={tags} />

            {description && (
              <MemorySection title={'Description'}>
                <div className={styles.sectionBody}>
                  <StreamingMarkdown>{description}</StreamingMarkdown>
                </div>
              </MemorySection>
            )}

            {(role || episodicDate || confidence !== undefined) && (
              <Flexbox
                horizontal
                align={'center'}
                className={styles.section}
                gap={16}
                style={{ paddingBlock: 12, paddingInline: 12 }}
                wrap={'wrap'}
              >
                {role && (
                  <Flexbox horizontal align={'center'} className={styles.chip} gap={6}>
                    <span>🎓</span>
                    <span>{role}</span>
                  </Flexbox>
                )}
                {episodicDate && (
                  <Flexbox horizontal align={'center'} gap={6}>
                    <span>📅</span>
                    <Text fontSize={12} type={'secondary'}>
                      {episodicDate}
                    </Text>
                  </Flexbox>
                )}
                {confidence !== undefined && (
                  <Flexbox horizontal align={'center'} gap={8}>
                    <Text fontSize={12} type={'secondary'} weight={500}>
                      Confidence
                    </Text>
                    <Progress percent={confidence} showInfo={false} size={[2, 12]} steps={5} />
                    <Text fontSize={12} type={'secondary'}>
                      {confidence}%
                    </Text>
                  </Flexbox>
                )}
              </Flexbox>
            )}

            {sourceEvidence && (
              <MemorySection title={'Evidence'} tone={'gold'}>
                <div className={localStyles.evidence}>{sourceEvidence}</div>
              </MemorySection>
            )}

            {labels.length > 0 && (
              <Flexbox
                horizontal
                className={styles.section}
                gap={8}
                style={{ paddingBlock: 12, paddingInline: 12 }}
                wrap={'wrap'}
              >
                {labels.map((label, index) => (
                  <Tag key={index}>{label}</Tag>
                ))}
              </Flexbox>
            )}
          </>
        ) : (
          <Flexbox className={styles.content} gap={8}>
            {!summary && loading ? (
              <BubblesLoading />
            ) : (
              <>
                {summary && <div className={styles.summary}>{summary}</div>}
                {details && <StreamingMarkdown>{details}</StreamingMarkdown>}
                {tags.length > 0 && (
                  <Flexbox horizontal className={styles.tags} gap={8} wrap={'wrap'}>
                    {tags.map((tag, index) => (
                      <Tag key={index}>{tag}</Tag>
                    ))}
                  </Flexbox>
                )}
              </>
            )}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

IdentityMemoryCard.displayName = 'IdentityMemoryCard';

export default IdentityMemoryCard;
