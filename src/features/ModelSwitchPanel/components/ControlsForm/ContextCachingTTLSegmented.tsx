import { Flexbox, Segmented, Text } from '@lobehub/ui';
import {
  CONTEXT_CACHING_TTL_OPTIONS,
  type ContextCachingTTL,
  DEFAULT_CONTEXT_CACHING_TTL,
} from 'model-bank/aiModel';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface ContextCachingTTLSegmentedProps {
  disabled?: boolean;
  /**
   * The TTL the next request will actually write (`resolveContextCachingTTL`), or
   * undefined when context caching is off and no breakpoint is written at all.
   */
  effectiveTTL?: ContextCachingTTL;
  onChange?: (value: ContextCachingTTL) => void;
  value?: ContextCachingTTL;
}

const ContextCachingTTLSegmented = memo<ContextCachingTTLSegmentedProps>(
  ({ disabled, effectiveTTL, onChange, value }) => {
    const { t } = useTranslation('chat');
    const cachingOff = !effectiveTTL;

    return (
      <Flexbox gap={6}>
        <Segmented<ContextCachingTTL>
          block
          disabled={disabled || cachingOff}
          size={'small'}
          style={{ maxWidth: 240 }}
          value={value ?? DEFAULT_CONTEXT_CACHING_TTL}
          options={CONTEXT_CACHING_TTL_OPTIONS.map((ttl) => ({
            label: t(`extendParams.contextCachingTTL.options.${ttl}`),
            value: ttl,
          }))}
          onChange={onChange}
        />
        <Text fontSize={12} type={'secondary'}>
          {cachingOff
            ? t('extendParams.contextCachingTTL.cachingOff')
            : t(
                value
                  ? 'extendParams.contextCachingTTL.effective'
                  : 'extendParams.contextCachingTTL.effectiveDefault',
                { ttl: t(`extendParams.contextCachingTTL.options.${effectiveTTL}`) },
              )}
        </Text>
      </Flexbox>
    );
  },
);

export default ContextCachingTTLSegmented;
