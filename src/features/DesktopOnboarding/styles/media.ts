import { createStaticStyles } from 'antd-style';

// 媒体元素相关的通用样式
export const mediaStyles = createStaticStyles(({ css }) => ({
  // 圆形图片
  circleImage: css`
    border-radius: 50%;
    object-fit: cover;
  `,

  // 覆盖式图片 - 填充容器
  coverImage: css`
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,

  // 图片容器
  imageContainer: css`
    position: relative;
    overflow: hidden;
  `,

  // 响应式图片 - 保持宽高比
  responsiveImage: css`
    max-width: 100%;
    height: auto;
    object-fit: contain;
  `,

  // 响应式视频
  responsiveVideo: css`
    width: 100%;
    height: 100%;
    object-fit: cover;
  `,
}));
