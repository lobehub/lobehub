import { GeneratingBorder } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <GeneratingBorder generating={variant === 'generating'}>
    <div style={{ height: 80, padding: 12 }}>Writing deterministic content</div>
  </GeneratingBorder>
);
