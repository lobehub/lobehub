import { Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  title: css`
    font-size: 28px;
    font-weight: 700;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
}));

const PersonaHeader = memo(() => {
  return (
    <Text as={'h1'} className={styles.title}>
      Persona
    </Text>
  );
});

export default PersonaHeader;
