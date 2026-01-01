import { Button, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { memo } from 'react';

interface ActionIconWithChevronProps extends ComponentProps<typeof Button> {
  icon: LucideIcon;
}

const ActionIconWithChevron = memo<ActionIconWithChevronProps>(
  ({ icon, title, style, disabled, type = 'text', ...rest }) => {
    return (
      <Button
        disabled={disabled}
        style={{ paddingInline: 4, ...style }}
        title={title}
        type={type}
        {...rest}
      >
        <Flexbox align={'center'} gap={4} horizontal>
          <Icon color={cssVar.colorIcon} icon={icon} size={18} />
          <Icon color={cssVar.colorIcon} icon={ChevronDownIcon} size={14} />
        </Flexbox>
      </Button>
    );
  },
);

ActionIconWithChevron.displayName = 'ActionIconWithChevron';

export default ActionIconWithChevron;
