import { Flexbox, Icon } from '@lobehub/ui';
import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo } from 'react';

import ImperativeModal from '@/components/ImperativeModal';

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
    return (
      <ImperativeModal
        centered
        afterOpenChange={onOpenChange}
        closable={false}
        footer={null}
        height={height}
        open={open}
        width={width}
        title={
          <Flexbox horizontal gap={8}>
            <Icon icon={icon} />
            {title}
          </Flexbox>
        }
      >
        {children}
      </ImperativeModal>
    );
  },
);

export default DataStyleModal;
