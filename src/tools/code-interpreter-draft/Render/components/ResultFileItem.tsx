import { type CodeInterpreterFileItem } from '@lobechat/types';
import { Icon, Image, MaterialFileTypeIcon, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Download } from 'lucide-react';
import React, { memo } from 'react';

import { fileService } from '@/services/file';
import { useChatStore } from '@/store/chat';

const imageStyles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};

    transition: all 0.2s ease;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 2px 8px ${cssVar.colorFillQuaternary};
    }
  `,
}));

const fileStyles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    cursor: pointer;

    display: inline-flex;
    gap: ${cssVar.marginXS};
    align-items: center;

    padding-block: ${cssVar.paddingXS};
    padding-inline: ${cssVar.paddingSM};
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusSM};

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};

    transition: all 0.2s ease;

    &:hover {
      border-color: ${cssVar.colorPrimary};
      background: ${cssVar.colorBgTextHover};
    }
  `,
}));

function basename(filename: string) {
  return filename.split('/').pop() ?? filename;
}

// 图片显示子组件
const ResultImage = memo<CodeInterpreterFileItem>(({ filename, previewUrl, fileId }) => {
  const [useFetchPythonFileItem] = useChatStore((s) => [s.useFetchInterpreterFileItem]);
  const { data } = useFetchPythonFileItem(fileId);
  const styles = imageStyles;

  const imageUrl = data?.url ?? previewUrl;
  const baseName = basename(data?.filename ?? filename);

  if (imageUrl) {
    return (
      <div className={styles.container}>
        <Tooltip title={baseName}>
          <Image alt={baseName} onLoad={() => URL.revokeObjectURL(imageUrl)} src={imageUrl} />
        </Tooltip>
      </div>
    );
  }

  return null;
});

// 文件显示子组件
const ResultFile = memo<CodeInterpreterFileItem>(({ filename, fileId, previewUrl }) => {
  const styles = fileStyles;
  const baseName = basename(filename);
  const onDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    let downloadUrl = previewUrl;
    if (!downloadUrl) {
      const { url } = await fileService.getFile(fileId!);
      downloadUrl = url;
    }
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = baseName;
    link.click();
  };
  return (
    <div className={styles.container} onClick={onDownload}>
      <MaterialFileTypeIcon filename={baseName} size={20} type="file" />
      <Text>{baseName}</Text>
      <Icon icon={Download} size={'small'} />
    </div>
  );
});

export { ResultFile, ResultImage };
