import { Flexbox, Icon, Modal } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import { useIsDark } from '@/hooks/useIsDark';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  modalTitleDark: css`
    &.${prefixCls}-modal-header {
      height: 80px;
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, ${cssVar.colorBgElevated} 0%, transparent),
          ${cssVar.colorBgContainer} 80px
        ),
        fixed 0 0 /10px 10px radial-gradient(${cssVar.colorFill} 1px, transparent 0);
    }

    & .${prefixCls}-modal-title {
      font-size: 24px;
    }
  `,
  modalTitleLight: css`
    &.${prefixCls}-modal-header {
      height: 80px;
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, ${cssVar.colorBgElevated} 0%, transparent),
          ${cssVar.colorBgContainer} 140px
        ),
        fixed 0 0 /10px 10px radial-gradient(${cssVar.colorFill} 1px, transparent 0);
    }

    & .${prefixCls}-modal-title {
      font-size: 24px;
    }
  `,
}));

interface DataStyleModalProps {
  children: ReactNode;
  height?: number | string;
  icon: LucideIcon;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
  title: string;
  width?: number;
}

const DataStyleModal = memo<DataStyleModalProps>(
  ({ icon, onOpenChange, title, open, children, width = 550, height }) => {
    const isDarkMode = useIsDark();

    return (
      <Modal
        centered
        afterOpenChange={onOpenChange}
        closable={false}
        footer={null}
        height={height}
        open={open}
        width={width}
        classNames={{
          header: isDarkMode ? styles.modalTitleDark : styles.modalTitleLight,
        }}
        title={
          <Flexbox horizontal gap={8}>
            <Icon icon={icon} />
            {title}
          </Flexbox>
        }
      >
        {children}
      </Modal>
    );
  },
);

export default DataStyleModal;
