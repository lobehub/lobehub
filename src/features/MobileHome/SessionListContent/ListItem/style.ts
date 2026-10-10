import { createStaticStyles, cx, lobeStaticStylish } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    actions: css`
      position: absolute;
      inset-block-start: 50%;
      inset-inline-end: 16px;
      transform: translateY(-50%);
    `,
    active: lobeStaticStylish.active,
    content: css`
      position: relative;
      overflow: hidden;
      flex: 1;
      align-self: center;
    `,
    date: css`
      font-size: 12px;
      color: ${cssVar.colorTextPlaceholder};
    `,
    desc: css`
      width: 100%;
      margin: 0;

      font-size: 12px;
      line-height: 1.2;
      color: ${cssVar.colorTextDescription};
    `,

    pin: css`
      position: absolute;
      inset-block-start: 6px;
      inset-inline-end: 6px;
    `,
    root: cx(
      lobeStaticStylish.variantBorderless,
      css`
        cursor: pointer;
        position: relative;
        border-radius: ${cssVar.borderRadius};
        color: ${cssVar.colorTextTertiary};
      `,
    ),

    title: css`
      width: 100%;
      margin: 0;

      font-size: 14px;
      font-weight: 500;
      line-height: 1.2;
      color: ${cssVar.colorText};
    `,
    triangle: css`
      width: 10px;
      height: 10px;
      border-radius: 2px;

      opacity: 0.5;
      background: ${cssVar.colorPrimaryBorder};
      clip-path: polygon(0% 0%, 100% 0%, 100% 100%);
    `,
  };
});
