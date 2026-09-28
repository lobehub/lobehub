import { type IThreadType, ThreadType } from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Divider } from 'antd';
import { cssVar } from 'antd-style';
import { GitBranch } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ThreadDividerProps {
  threadType?: IThreadType;
}

/**
 * Sits under the fork message — the only main-chat message rendered in the
 * thread portal — and states what context the thread carries: a standalone
 * thread inherits just that message, everything else continues with the main
 * chat history up to it.
 */
const ThreadDivider = memo<ThreadDividerProps>(({ threadType }) => {
  const { t } = useTranslation('chat');

  return (
    <div style={{ padding: '0 20px' }}>
      <Divider style={{ margin: 0, padding: '20px 0' }}>
        <Flexbox
          horizontal
          align={'center'}
          gap={6}
          style={{ color: cssVar.colorTextDescription, fontSize: 12 }}
        >
          <Icon icon={GitBranch} size={12} />
          {threadType === ThreadType.Standalone
            ? t('thread.dividerStandalone')
            : t('thread.dividerContinuation')}
        </Flexbox>
      </Divider>
    </div>
  );
});

export default ThreadDivider;
