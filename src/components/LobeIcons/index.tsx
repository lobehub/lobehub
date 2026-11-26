import { BRANDING_MODEL_IDS } from '@lobechat/business-const';
import { DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import type {
  ModelIcon as LobeModelIcon,
  ModelTag as LobeModelTag,
  ProviderCombine as LobeProviderCombine,
  ProviderIcon as LobeProviderIcon,
} from '@lobehub/icons';
import { Avatar, Skeleton, Tag } from '@lobehub/ui';
import type { ComponentProps } from 'react';
import { lazy, Suspense } from 'react';

// The catalog-backed features of @lobehub/icons statically import every brand
// icon (~3 MB). Mounting them through lazy() keeps that catalog in one shared
// chunk that loads after paint instead of inside each route's closure.
const LazyModelIcon = lazy(() =>
  import('@/libs/modelIcon').then(({ ModelIcon }) => ({ default: ModelIcon })),
);
const LazyModelTag = lazy(() =>
  import('@/libs/modelIcon').then(({ ModelTag }) => ({ default: ModelTag })),
);
const LazyProviderIcon = lazy(() =>
  import('@/libs/providerIcon').then(({ ProviderIcon }) => ({ default: ProviderIcon })),
);
const LazyProviderCombine = lazy(() =>
  import('@/libs/providerIcon').then(({ ProviderCombine }) => ({ default: ProviderCombine })),
);

const DEFAULT_SIZE = 24;
/** Size `@lobehub/icons` gives a model icon when the caller passes none. */
const ICONS_DEFAULT_SIZE = 12;

const isBrandingModel = (model?: string) => !!model && BRANDING_MODEL_IDS.includes(model);

/** The inbox agent's avatar, standing in for the vendor mark of a model the product provides. */
const BrandingModelAvatar = ({
  className,
  model,
  shape,
  size = ICONS_DEFAULT_SIZE,
  style,
}: ComponentProps<typeof LobeModelIcon>) => (
  <Avatar
    alt={model}
    avatar={DEFAULT_INBOX_AVATAR}
    className={className}
    shape={shape}
    size={size}
    style={style}
  />
);

export const ModelIcon = (props: ComponentProps<typeof LobeModelIcon>) => {
  if (isBrandingModel(props.model)) return <BrandingModelAvatar {...props} />;

  const size = props.size ?? DEFAULT_SIZE;
  return (
    <Suspense fallback={<Skeleton height={size} width={size} />}>
      <LazyModelIcon {...props} />
    </Suspense>
  );
};

export const ProviderIcon = (props: ComponentProps<typeof LobeProviderIcon>) => {
  const size = props.size ?? DEFAULT_SIZE;
  return (
    <Suspense fallback={<Skeleton height={size} width={size} />}>
      <LazyProviderIcon {...props} />
    </Suspense>
  );
};

export const ModelTag = (props: ComponentProps<typeof LobeModelTag>) => {
  if (isBrandingModel(props.model)) {
    const { model, type: _type, ...rest } = props;
    return (
      <Tag icon={<BrandingModelAvatar model={model} />} {...rest}>
        {model}
      </Tag>
    );
  }

  return (
    <Suspense fallback={<Skeleton height={22} width={96} />}>
      <LazyModelTag {...props} />
    </Suspense>
  );
};

export const ProviderCombine = (props: ComponentProps<typeof LobeProviderCombine>) => {
  const size = props.size ?? DEFAULT_SIZE;
  return (
    <Suspense fallback={<Skeleton height={size} width={size * 4} />}>
      <LazyProviderCombine {...props} />
    </Suspense>
  );
};
