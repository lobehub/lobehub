import type { BuiltinStreamingProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Skeleton, Text } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

import { createNativeUIState } from '../../native/engine';
import { NativeUIRenderer } from '../../native/renderer';
import { NativeUIDocumentSchema } from '../../native/schema';

/** Partial JSON never gains capabilities. A structurally complete native
 * snapshot can preview with disabled controls; incomplete trees stay skeletons. */
export const StreamingUI = ({ args }: BuiltinStreamingProps<unknown>) => {
  const { t } = useTranslation('plugin');
  const parsed = NativeUIDocumentSchema.safeParse(args);
  if (parsed.success) {
    return (
      <NativeUIRenderer
        disabled
        readOnly
        document={parsed.data}
        state={createNativeUIState(parsed.data)}
        onPropose={() => {}}
        onStateChange={() => {}}
      />
    );
  }
  return (
    <Flexbox gap={12}>
      <Text role="status" type="secondary">
        {t('builtins.lobe-interactive-ui.generating')}
      </Text>
      <Skeleton height={240} width="100%" />
    </Flexbox>
  );
};
