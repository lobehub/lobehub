import { Flexbox, Icon, Modal } from '@lobehub/ui';
import { createStaticStyles, useThemeMode } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { type ReactNode, memo } from 'react';

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
    const { isDarkMode } = useThemeMode();

    return (
      <Modal
        afterOpenChange={onOpenChange}
        centered
        classNames={{
          header: isDarkMode ? styles.modalTitleDark : styles.modalTitleLight,
        }}
        closable={false}
        footer={null}
        height={height}
        open={open}
        title={
          <Flexbox gap={8} horizontal>
            <Icon icon={icon} />
            {title}
          </Flexbox>
        }
        width={width}
      >
        {children}
      </Modal>
    );
  },
);

export default DataStyleModal;
