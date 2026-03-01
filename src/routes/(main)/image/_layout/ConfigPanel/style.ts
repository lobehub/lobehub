import { createStaticStyles } from 'antd-style';

export const configPanelStyles = createStaticStyles(({ css, cssVar }) => ({
  dragOver: css`
    transform: scale(1.02);
    border-color: ${cssVar.colorPrimary} !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, ${cssVar.colorPrimary} 12.5%, transparent);
    transition: transform 0.2s ease;
  `,

  dragTransition: css`
    transition:
      transform 0.2s ease,
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  `,
}));
