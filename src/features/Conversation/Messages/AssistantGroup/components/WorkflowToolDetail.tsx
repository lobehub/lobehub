import { createStaticStyles, cssVar } from 'antd-style';
import { AnimatePresence, m as motion } from 'motion/react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  panel: css`
    margin-inline-start: 22px;
    padding-block: 6px;
    padding-inline: 10px;
    border-inline-start: 2px solid ${cssVar.colorBorder};
    border-radius: 6px;

    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillQuaternary};
  `,
  pre: css`
    margin: 0;
    padding: 0;

    font-family: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    word-break: break-all;
    white-space: pre-wrap;
  `,
}));

interface WorkflowToolDetailProps {
  content: string;
  open: boolean;
}

const WorkflowToolDetail = memo<WorkflowToolDetailProps>(({ content, open }) => {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          key="tool-detail"
          style={{ overflow: 'hidden' }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
        >
          <div className={styles.panel}>
            <pre className={styles.pre}>{content}</pre>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

WorkflowToolDetail.displayName = 'WorkflowToolDetail';

export default WorkflowToolDetail;
