// GOOD fixture (false-positive regression): monospace via a cssVar ternary; it must not trip LOBE-FONT-FAMILY.
'use client';

import { ModelIcon } from '@lobehub/icons';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui';
import { memo } from 'react';

interface ModelInTableProps {
  /** Render the id in monospace, matching identifier columns. */
  code?: boolean;
  model?: string | null;
}

const ModelInTable = memo<ModelInTableProps>(({ code = true, model }) => {
  if (!model) return '--';

  return (
    <Flexbox horizontal align={'center'} gap={6} style={{ maxWidth: '100%', minWidth: 0 }}>
      <ModelIcon model={model} size={18} style={{ flexShrink: 0 }} type={'avatar'} />
      <span
        style={{
          fontFamily: code ? cssVar.fontFamilyCode : undefined,
          fontSize: code ? 12 : undefined,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {model}
      </span>
    </Flexbox>
  );
});

ModelInTable.displayName = 'ModelInTable';

export default ModelInTable;
