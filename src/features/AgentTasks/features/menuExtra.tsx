import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckIcon } from 'lucide-react';

const renderCheck = () => <Icon color={cssVar.colorTextSecondary} icon={CheckIcon} size={14} />;

export const renderMenuExtra = (shortcut: string, isCurrent: boolean) =>
  isCurrent ? (
    <Flexbox horizontal align={'center'} gap={6}>
      {renderCheck()}
      {shortcut}
    </Flexbox>
  ) : (
    shortcut
  );
