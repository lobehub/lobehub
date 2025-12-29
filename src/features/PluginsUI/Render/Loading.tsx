import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, keyframes } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const animloader = keyframes`
  0% {
    inset-inline-start: 0;
    transform: translateX(-100%);
  }

  100% {
    inset-inline-start: 100%;
    transform: translateX(0%);
  }
`;

const styles = createStaticStyles(
  ({ css, cssVar }) => css`
    position: relative;

    overflow: hidden;
    display: block;

    width: 300px;
    height: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 10px;

    &::after {
      content: '';

      position: absolute;
      inset-block-start: 0;
      inset-inline-start: 0;

      box-sizing: border-box;
      width: 40%;
      height: 100%;

      background: ${cssVar.colorPrimary};

      animation: ${animloader} 2s linear infinite;
    }
  `,
);
const Loading = memo(() => {
  const { t } = useTranslation('plugin');

  return (
    <Flexbox align={'center'} gap={8} padding={16}>
      <span className={styles} />
      {t('loading.content')}
    </Flexbox>
  );
});

export default Loading;
