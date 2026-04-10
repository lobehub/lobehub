import { Highlighter } from '@lobehub/ui';
import { AnimatePresence, m as motion } from 'motion/react';
import { memo, useMemo } from 'react';

interface WorkflowToolDetailProps {
  content: string;
  open: boolean;
}

const WorkflowToolDetail = memo<WorkflowToolDetailProps>(({ content, open }) => {
  const language = useMemo(() => {
    const trimmed = content.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    return 'plaintext';
  }, [content]);

  const formatted = useMemo(() => {
    if (language !== 'json') return content;
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }, [content, language]);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          key="tool-detail"
          style={{ marginBlock: '4px 8px', overflow: 'hidden', paddingInlineStart: 30 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        >
          <Highlighter wrap language={language} variant={'filled'}>
            {formatted}
          </Highlighter>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

WorkflowToolDetail.displayName = 'WorkflowToolDetail';

export default WorkflowToolDetail;
