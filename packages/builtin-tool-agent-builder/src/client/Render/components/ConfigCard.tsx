import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

interface ConfigCardProps {
  config: Record<string, unknown>;
  title?: string;
}

const ConfigCard = memo<ConfigCardProps>(({ config, title }) => {
  return (
    <Flexbox gap={8} style={{ fontSize: 13 }}>
      {title && (
        <span style={{ color: 'var(--lobe-text-secondary)', fontWeight: 500 }}>{title}</span>
      )}
      <pre
        style={{
          background: 'var(--lobe-fill-tertiary)',
          borderRadius: 6,
          color: 'var(--lobe-text)',
          fontSize: 12,
          margin: 0,
          maxHeight: 400,
          overflow: 'auto',
          padding: 12,
        }}
      >
        {JSON.stringify(config, null, 2)}
      </pre>
    </Flexbox>
  );
});

export default ConfigCard;
