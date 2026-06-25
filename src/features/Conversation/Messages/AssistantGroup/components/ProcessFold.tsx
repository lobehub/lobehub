import { Accordion, AccordionItem, Text } from '@lobehub/ui';
import { type Key, memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const PROCESS_KEY = 'process';

interface ProcessFoldProps {
  /** Rendered process (reasoning + tools + intermediate prose); shown only when expanded. */
  children: ReactNode;
  /** Whether the process starts expanded. */
  defaultExpanded?: boolean;
  /** Formatted turn duration, e.g. "3m 37s". Hidden when absent. */
  durationText?: string;
}

/**
 * Codex-style "已处理 {duration}" header that folds a finished turn's *process*
 * (reasoning + tool calls + intermediate narration) into one persistent,
 * toggleable row. The turn's final answer is rendered separately and stays
 * visible regardless of this state. Reuses the same Accordion chrome as
 * WorkflowCollapse so the right-aligned expand chevron matches. Purely a view
 * affordance — never persisted.
 */
const ProcessFold = memo<ProcessFoldProps>(
  ({ children, durationText, defaultExpanded = false }) => {
    const { t } = useTranslation('chat');
    const [expanded, setExpanded] = useState(defaultExpanded);
    const expandedKeys = useMemo(() => (expanded ? [PROCESS_KEY] : []), [expanded]);

    const title = (
      <Text style={{ minWidth: 0 }} type={'secondary'}>
        {durationText ? t('turnProcess.ranFor', { duration: durationText }) : t('turnProcess.done')}
      </Text>
    );

    return (
      <Accordion
        expandedKeys={expandedKeys}
        variant={'borderless'}
        onExpandedChange={(keys: Key[]) => setExpanded(keys.includes(PROCESS_KEY))}
      >
        <AccordionItem itemKey={PROCESS_KEY} paddingBlock={4} paddingInline={4} title={title}>
          {children}
        </AccordionItem>
      </Accordion>
    );
  },
);

ProcessFold.displayName = 'ProcessFold';

export default ProcessFold;
