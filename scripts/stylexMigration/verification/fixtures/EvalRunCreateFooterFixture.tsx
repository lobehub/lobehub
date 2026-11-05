import { EvalRunCreateFooter } from 'verification:component';

const noop = () => {};

export const Fixture = ({ variant }: { variant: string }) => (
  <EvalRunCreateFooter
    loading={variant === 'loading'}
    onCreateAndStart={noop}
    onCreateOnly={noop}
  />
);
