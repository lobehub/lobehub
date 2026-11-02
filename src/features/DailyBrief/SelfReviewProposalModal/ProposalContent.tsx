import {
  formatSelfReviewItemHeadline,
  type SelfReviewProposalContentItem,
} from '@lobechat/agent-signal/brief';
import { Block, createStaticStyles, Flexbox, Markdown, Text } from '@lobehub/ui';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useSelfReviewTranslator } from '../useSelfReviewBriefView';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow-y: auto;
    max-height: min(70vh, 720px);
    padding-block: 4px 16px;
    padding-inline: 20px;
  `,
  divider: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  headline: css`
    font-size: 15px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  label: css`
    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
  `,
  name: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  text: css`
    font-size: 14px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
  `,
}));

const Section = ({ children, label }: { children: ReactNode; label: string }) => (
  <Flexbox gap={4}>
    <span className={styles.label}>{label}</span>
    {children}
  </Flexbox>
);

const MarkdownBlock = ({ children }: { children: string }) => (
  <Block padding={12} variant={'outlined'}>
    <Markdown style={{ overflow: 'unset' }} variant={'chat'}>
      {children}
    </Markdown>
  </Block>
);

const ProposalItem = ({ item }: { item: SelfReviewProposalContentItem }) => {
  const { t } = useTranslation('home');
  const translate = useSelfReviewTranslator();

  // A new skill is named by the title it would get; a changed skill by its
  // current title. Memory text gets its own section, not the headline.
  const headline = formatSelfReviewItemHeadline(
    { kind: item.kind, target: item.title ?? item.name ?? item.target },
    translate,
  );

  return (
    <Flexbox gap={12}>
      <Flexbox gap={2}>
        <Text className={styles.headline}>{headline}</Text>
        {item.name && item.name !== item.title && <span className={styles.name}>{item.name}</span>}
      </Flexbox>
      {item.rationale && (
        <Section label={t('brief.agentSignal.selfReview.detail.rationale')}>
          <span className={styles.text}>{item.rationale}</span>
        </Section>
      )}
      {item.description && (
        <Section label={t('brief.agentSignal.selfReview.detail.description')}>
          <span className={styles.text}>{item.description}</span>
        </Section>
      )}
      {item.memoryContent && (
        <Section label={t('brief.agentSignal.selfReview.detail.memory')}>
          <span className={styles.text}>{item.memoryContent}</span>
        </Section>
      )}
      {item.systemRole && (
        <Section label={t('brief.agentSignal.selfReview.detail.systemRole')}>
          <MarkdownBlock>{item.systemRole}</MarkdownBlock>
        </Section>
      )}
      {item.bodyMarkdown && (
        <Section label={t('brief.agentSignal.selfReview.detail.body')}>
          <MarkdownBlock>{item.bodyMarkdown}</MarkdownBlock>
        </Section>
      )}
    </Flexbox>
  );
};

interface ProposalContentProps {
  items: SelfReviewProposalContentItem[];
}

/** Body of the self-review details modal: every proposed action in full. */
export const ProposalContent = ({ items }: ProposalContentProps) => (
  <Flexbox className={styles.container} gap={20}>
    {items.map((item, index) => (
      <Flexbox gap={20} key={index}>
        {index > 0 && <div className={styles.divider} />}
        <ProposalItem item={item} />
      </Flexbox>
    ))}
  </Flexbox>
);
