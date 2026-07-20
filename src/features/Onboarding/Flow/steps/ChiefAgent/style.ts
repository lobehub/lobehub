import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  avatarBig: css`
    position: absolute;
    inset-block-end: 20px;
    inset-inline-end: 20px;
  `,

  hero: css`
    pointer-events: none;

    position: absolute;
    inset-block-end: 0;
    inset-inline-end: 16px;

    height: calc(100% - 8px);
  `,

  identity: css`
    position: relative;
    max-inline-size: 55%;
  `,

  infoIcon: css`
    color: ${cssVar.colorTextTertiary};
  `,

  infoRow: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,

  nameEditIcon: css`
    cursor: pointer;
    color: ${cssVar.colorTextDescription};
  `,

  nameInput: css`
    padding: 0;
    font-size: 26px;
    font-weight: 700;
  `,

  nameRow: css`
    inline-size: fit-content;
    padding-block-end: 4px;
    border-block-end: 1px dashed ${cssVar.colorBorder};
  `,

  nameText: css`
    font-size: 26px;
    font-weight: 700;
  `,

  panel: css`
    position: relative;

    overflow: hidden;

    min-block-size: 176px;
    padding-block: 48px 20px;
    padding-inline: 20px;
    border-radius: ${cssVar.borderRadiusLG};

    background: linear-gradient(
      135deg,
      ${cssVar.colorFillTertiary} 0%,
      ${cssVar.colorFillSecondary} 100%
    );
  `,

  presetImage: css`
    pointer-events: none;

    position: absolute;
    inset-block-start: 2%;
    inset-inline-start: 50%;
    transform: translateX(-50%);

    inline-size: 135%;
    max-inline-size: none;
  `,

  presetTile: css`
    cursor: pointer;

    position: relative;

    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;

    aspect-ratio: 1;
    width: 100%;
    border: 2px solid transparent;
    border-radius: ${cssVar.borderRadiusLG};

    transition:
      border-color 0.15s,
      transform 0.15s;

    &:hover {
      transform: translateY(-1px);
    }
  `,

  presetTileSelected: css`
    && {
      border-color: ${cssVar.colorText};
    }
  `,

  presetTileUpload: css`
    && {
      border: 1px solid ${cssVar.colorBorderSecondary};
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorBgContainer};
    }

    &&:hover {
      border-color: ${cssVar.colorBorder};
      background: ${cssVar.colorFillQuaternary};
    }
  `,

  presetsGrid: css`
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;

    .ant-upload-wrapper,
    .ant-upload,
    .ant-spin-nested-loading,
    .ant-spin-container {
      display: block;
      inline-size: 100%;
    }
  `,
}));
