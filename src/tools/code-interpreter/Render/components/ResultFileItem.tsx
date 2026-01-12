import { CodeInterpreterFileItem } from '@lobechat/types';
import { Icon, Image, MaterialFileTypeIcon, Text, Tooltip } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Download } from 'lucide-react';
import React, { memo } from 'react';

import { fileService } from '@/services/file';
import { useChatStore } from '@/store/chat';

const useImageStyles = createStyles(({ css, token }) => ({
  container: css`
    overflow: hidden;

    border: 1px solid ${token.colorBorder};
    border-radius: 8px;

    background: ${token.colorBgContainer};

    transition: all 0.2s ease;

    &:hover {
      border-color: ${token.colorPrimary};
      box-shadow: 0 2px 8px ${token.colorFillQuaternary};
    }
  `,
}));

const useFileStyles = createStyles(({ css, token }) => ({
  container: css`
    cursor: pointer;

    display: inline-flex;
    gap: ${token.marginXS}px;
    align-items: center;

    padding-block: ${token.paddingXS}px;
    padding-inline: ${token.paddingSM}px;
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadiusSM}px;

    font-size: ${token.fontSizeSM}px;
    color: ${token.colorText};

    background: ${token.colorBgContainer};

    transition: all 0.2s ease;

    &:hover {
      border-color: ${token.colorPrimary};
      background: ${token.colorBgTextHover};
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
  const { styles } = useImageStyles();

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
  const { styles } = useFileStyles();
  const baseName = basename(filename);
  const onDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    let downloadUrl = previewUrl;
    if (!downloadUrl && fileId) {
      const { url } = await fileService.getFile(fileId);
      downloadUrl = url;
    }
    if (downloadUrl) {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = baseName;
      link.click();
    }
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
