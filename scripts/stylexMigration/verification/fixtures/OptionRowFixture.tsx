import { OptionRow } from 'verification:component';

export const Fixture = ({ variant }: { variant: string }) => (
  <OptionRow
    active={variant === 'active'}
    desc="Deterministic description"
    disabled={variant === 'disabled'}
    extra={<button type="button">Details</button>}
    icon={<span aria-hidden>◎</span>}
    label="Option"
    tag="Local"
    onClick={() => {}}
  />
);
