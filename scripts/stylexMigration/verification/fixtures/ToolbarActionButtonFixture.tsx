import { EyeIcon } from 'lucide-react';
import { ToolbarActionButton } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <div
    dir={variant === 'rtl' ? 'rtl' : 'ltr'}
    style={{
      containerType: 'inline-size',
      width: variant === 'narrow' ? 299 : variant === 'boundary' ? 300 : '100%',
    }}
  >
    <ToolbarActionButton
      active={variant === 'active'}
      disabled={variant === 'disabled'}
      icon={EyeIcon}
      label="Preview file"
      loading={variant === 'loading'}
    />
  </div>
);
