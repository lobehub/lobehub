import { Icon, type IconSize } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { type CSSProperties, memo } from 'react';

interface UpdateLoadingProps {
  size?: IconSize;
  style?: CSSProperties;
}

const UpdateLoading = memo<UpdateLoadingProps>(({ size, style }) => {
  return (
    <div style={style}>
      <Icon icon={Loader2} size={size} spin />
    </div>
  );
});

export default UpdateLoading;
