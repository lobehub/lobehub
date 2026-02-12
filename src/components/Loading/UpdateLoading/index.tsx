import { type IconSize } from '@lobehub/ui';
import { Icon } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { type CSSProperties } from 'react';
import { memo } from 'react';

interface UpdateLoadingProps {
  size?: IconSize;
  style?: CSSProperties;
}

const UpdateLoading = memo<UpdateLoadingProps>(({ size, style }) => {
  return (
    <div style={style}>
      <Icon spin icon={Loader2} size={size} />
    </div>
  );
});

export default UpdateLoading;
