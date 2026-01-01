import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const styles = createStaticStyles(({ css, cssVar }) => ({
  button: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    min-width: 60px;
    height: 32px;
    padding-block: 0;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius}px;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};

    transition: all 0.2s ease;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorBgTextHover};
    }
  `,

  container: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,

  selectedButton: css`
    border-color: ${cssVar.colorPrimary};
    color: ${cssVar.colorPrimary};
    background: ${cssVar.colorPrimaryBg};

    &:hover {
      border-color: ${cssVar.colorPrimary};
      color: ${cssVar.colorPrimary};
      background: ${cssVar.colorPrimaryBgHover};
    }
  `,
}));

const ResolutionSelect = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('resolution');

  const handleClick = useCallback(
    (resolution: string) => {
      setValue(resolution);
    },
    [setValue],
  );

  if (!enumValues || enumValues.length === 0) {
    return null;
  }

  return (
    <Flexbox className={styles.container} horizontal>
      {enumValues.map((resolution) => (
        <button
          className={cx(styles.button, value === resolution && styles.selectedButton)}
          key={resolution}
          onClick={() => handleClick(resolution)}
          type="button"
        >
          {t(`config.resolution.options.${resolution}`, { defaultValue: resolution })}
        </button>
      ))}
    </Flexbox>
  );
});

export default ResolutionSelect;
