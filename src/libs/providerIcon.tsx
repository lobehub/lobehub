/* eslint-disable eslint-core/no-restricted-imports -- the lazy wrapper in @/components/LobeIcons is the only importer */
import {
  ProviderCombine as LobeProviderCombine,
  ProviderIcon as LobeProviderIcon,
} from '@lobehub/icons';
/* eslint-enable eslint-core/no-restricted-imports */
import { Avatar, Flexbox } from '@lobehub/ui';
import type { ComponentProps } from 'react';

// Do not turn these back into `export { ... }` re-exports: with rolldown's
// strictExecutionOrder (rolldown 1.2.12) the icon modules' init wrappers are
// then never called in production chunks, both exports stay undefined and the
// lazy loaders in @/components/LobeIcons crash with React #306.
export const ProviderIcon = (props: ComponentProps<typeof LobeProviderIcon>) => {
  if (props.provider?.toLowerCase() !== 'modelfold') return <LobeProviderIcon {...props} />;

  if (props.type === 'combine' || props.type === 'combine-color')
    return (
      <ProviderCombine
        className={props.className}
        provider="modelfold"
        size={props.size}
        style={props.style}
      />
    );

  return (
    <Avatar
      alt="ModelFold"
      avatar="/avatars/modelfold.png"
      className={props.className}
      shape={props.shape}
      size={props.size ?? 24}
      style={props.style}
    />
  );
};

export const ProviderCombine = (props: ComponentProps<typeof LobeProviderCombine>) => {
  if (props.provider?.toLowerCase() !== 'modelfold') return <LobeProviderCombine {...props} />;

  const { provider, size = 24, type: _type, ...rest } = props;
  return (
    <Flexbox horizontal align="center" gap={6} {...rest}>
      <ProviderIcon provider={provider} size={size} />
      ModelFold
    </Flexbox>
  );
};
