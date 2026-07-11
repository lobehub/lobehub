import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  avatarBig: css`
    flex: none;
  `,

  gridLabel: css`
    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,

  hint: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,

  infoRow: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,

  nameEditIcon: css`
    cursor: pointer;
    color: ${cssVar.colorTextDescription};
  `,

  nameInput: css`
    padding: 0;
    font-size: 24px;
    font-weight: 700;
  `,

  nameText: css`
    font-size: 24px;
    font-weight: 700;
  `,

  panel: css`
    position: relative;

    overflow: hidden;

    padding: 20px;
    border-radius: ${cssVar.borderRadiusLG};

    background: linear-gradient(
      135deg,
      ${cssVar.colorFillTertiary} 0%,
      ${cssVar.colorFillSecondary} 100%
    );
  `,

  presetTile: css`
    cursor: pointer;

    display: flex;
    align-items: center;
    justify-content: center;

    aspect-ratio: 1;
    width: 100%;
    border: 2px solid transparent;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    transition:
      border-color 0.15s,
      background 0.15s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,

  presetTileSelected: css`
    border-color: ${cssVar.colorPrimary};
  `,

  presetTileUpload: css`
    color: ${cssVar.colorTextDescription};
    background: ${cssVar.colorFillQuaternary};
  `,

  presetsGrid: css`
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px;
  `,
}));
