import { DotsLoading } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) =>
  variant === 'custom' ? <DotsLoading color="#345678" gap={6} size={8} /> : <DotsLoading />;
