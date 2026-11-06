import {
  formatSelfReviewItemHeadline,
  type SelfReviewProposalContentItem,
} from '@lobechat/agent-signal/brief';
import { Block, Flexbox, Markdown, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useSelfReviewTranslator } from '../useSelfReviewBriefView';

const styles = stylex.create({
  container: {
    overflowY: 'auto',
    maxHeight: 'min(70vh, 720px)',
    paddingBlockStart: '4px',
    paddingBlockEnd: '16px',
    paddingInline: '20px',
  },
  divider: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
  },
  headline: { fontSize: '15px', fontWeight: 600, color: cssVar.colorText },
  label: { fontSize: '12px', fontWeight: 500, color: cssVar.colorTextTertiary },
  name: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px', color: cssVar.colorTextTertiary },
  text: {
    fontSize: '14px',
    lineHeight: 1.6,
    color: cssVar.colorTextSecondary,
    whiteSpace: 'pre-wrap',
  },
});

const Section = ({ children, label }: { children: ReactNode; label: string }) => (
  <Flexbox gap={4}>
    <span {...stylex.props(styles.label)}>{label}</span>
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
        <Text className={stylex.props(styles.headline).className}>{headline}</Text>
        {item.name && item.name !== item.title && (
          <span {...stylex.props(styles.name)}>{item.name}</span>
        )}
      </Flexbox>
      {item.rationale && (
        <Section label={t('brief.agentSignal.selfReview.detail.rationale')}>
          <span {...stylex.props(styles.text)}>{item.rationale}</span>
        </Section>
      )}
      {item.description && (
        <Section label={t('brief.agentSignal.selfReview.detail.description')}>
          <span {...stylex.props(styles.text)}>{item.description}</span>
        </Section>
      )}
      {item.memoryContent && (
        <Section label={t('brief.agentSignal.selfReview.detail.memory')}>
          <span {...stylex.props(styles.text)}>{item.memoryContent}</span>
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
  <Flexbox className={stylex.props(styles.container).className} gap={20}>
    {items.map((item, index) => (
      <Flexbox gap={20} key={index}>
        {index > 0 && <div {...stylex.props(styles.divider)} />}
        <ProposalItem item={item} />
      </Flexbox>
    ))}
  </Flexbox>
);
