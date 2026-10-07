'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';

import { ModelIcon } from '@/components/LobeIcons';

const styles = createStaticStyles(({ css }) => ({
  model: css`
    overflow: hidden;

    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  provider: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
}));

export interface ModelLabelProps {
  model: string;
  provider?: string | null;
  /** Show the provider beside the name (default) or hide it in tight rows. */
  showProvider?: boolean;
  size?: number;
}

/** A model as people recognise it: brand icon, name, and where it is served from. */
const ModelLabel = ({ model, provider, showProvider = true, size = 18 }: ModelLabelProps) => (
  <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
    <ModelIcon model={model} size={size} />
    <span className={styles.model} title={model}>
      {model}
    </span>
    {showProvider && provider && <span className={styles.provider}>{provider}</span>}
  </Flexbox>
);

export default ModelLabel;
