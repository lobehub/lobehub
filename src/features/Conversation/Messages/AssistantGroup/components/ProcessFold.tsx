import { Flexbox, Icon } from '@lobehub/ui';
import { Accordion, Text } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PROCESS_KEY = 'process';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    min-width: 0;
    color: ${cssVar.colorTextTertiary};
    transition: color 150ms ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));

/**
 * The Accordion's borderless header paints a hover fill that bleeds outward
 * through a negative inline margin, and `message-body`'s `overflow: hidden`
 * clips that into cut corners. Stripping the header chrome leaves a bare text
 * row sitting on the answer's baseline, with hover reading as the text
 * brightening instead. Inline styles are deliberate — they outrank the
 * package's `:hover` background rule without an `!important`.
 */
const HEADER_STYLE = { background: 'transparent', margin: 0 } as const;
const TRIGGER_STYLE = { padding: 0 } as const;
/** The stripped header has no padding of its own, so the expanded process would
 *  otherwise start flush against it. */
const CONTENT_STYLE = { paddingBlockStart: 8 } as const;

interface ProcessFoldProps {
  /** Rendered process (reasoning + tools + intermediate prose); shown only when expanded. */
  children: ReactNode;
  /** Whether the process starts expanded. */
  defaultExpanded?: boolean;
  /** Formatted turn duration, e.g. "3m 37s". Hidden when absent. */
  durationText?: string;
  /** Number of steps in the turn = count of assistant (call_llm) messages. */
  stepCount: number;
}

/**
 * Codex-style "已处理 {duration}" header that folds a finished turn's *process*
 * (reasoning + tool calls + intermediate narration) into one persistent,
 * toggleable row. The turn's final answer is rendered separately and stays
 * visible regardless of this state. Purely a view affordance — never persisted.
 */
const ProcessFold = memo<ProcessFoldProps>(
  ({ children, durationText, stepCount, defaultExpanded = false }) => {
    const { t } = useTranslation('chat');
    const [expanded, setExpanded] = useState(defaultExpanded);
    const value = useMemo(() => (expanded ? [PROCESS_KEY] : []), [expanded]);

    const title = (
      <Flexbox horizontal align={'center'} className={styles.title} gap={6}>
        <Text style={{ color: 'inherit', minWidth: 0 }}>
          {durationText
            ? t('turnProcess.ranFor', { count: stepCount, duration: durationText })
            : t('turnProcess.done', { count: stepCount })}
        </Text>
        <Icon
          icon={ChevronRight}
          size={14}
          style={{
            flex: 'none',
            transform: expanded ? 'rotate(90deg)' : undefined,
            transition: 'transform 200ms',
          }}
        />
      </Flexbox>
    );

    return (
      <>
        <Accordion
          hideIndicator
          items={[{ children, key: PROCESS_KEY, title }]}
          styles={{ content: CONTENT_STYLE, header: HEADER_STYLE, trigger: TRIGGER_STYLE }}
          value={value}
          variant={'borderless'}
          onValueChange={(next) => setExpanded(next.includes(PROCESS_KEY))}
        />
        <Divider style={{ marginBlock: 0 }} />
      </>
    );
  },
);

ProcessFold.displayName = 'ProcessFold';

export default ProcessFold;
