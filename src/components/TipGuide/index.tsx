import { ActionIcon, Flexbox, Popover } from '@lobehub/ui';
import type {TooltipProps} from 'antd';
import { ConfigProvider  } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { XIcon } from 'lucide-react';
import type {CSSProperties, FC, ReactNode} from 'react';

const styles = createStaticStyles(({ css }) => {
  return {
    close: css`
      color: white;
    `,
    container: css`
      position: relative;
    `,
    footer: css`
      display: flex;
      justify-content: end;
      width: 100%;
    `,
    overlay: css`
      .ant-popover-inner {
        border: none;
      }
    `,
    tip: css`
      position: absolute;
      inset-inline-start: 50%;
      transform: translate(-50%);
    `,
  };
});

export interface TipGuideProps {
  /**
   * 引导内容
   */
  children?: ReactNode;
  /**
   * 类名
   */
  className?: string;
  /**
   * 默认时候的打开状态
   */
  defaultOpen?: boolean;
  /**
   * 用于自定义 footer 部分的 render api
   */
  footerRender?: (dom: ReactNode) => ReactNode;
  /**
   * 最大宽度
   */
  maxWidth?: number;
  /**
   * 纵向偏移值
   */
  offsetY?: number;
  /**
   * 当 open 属性变化时候的触发
   */
  onOpenChange: (open: boolean) => void;
  /**
   * 受控的 open 属性
   */
  open?: boolean;
  /**
   * Tooltip 位置，默认为 bottom
   */
  placement?: TooltipProps['placement'];
  /**
   * style
   */
  style?: CSSProperties;
  tip?: boolean;
  /**
   * 引导标题
   */
  title: string;
}

const TipGuide: FC<TipGuideProps> = ({
  children,
  placement = 'bottom',
  title,
  offsetY,
  maxWidth = 300,
  className,
  style,
  open,
  onOpenChange: setOpen,
}) => {
  return (
    <ConfigProvider
      theme={{
        components: {
          Badge: { fontSize: 12, lineHeight: 1 },
          Button: { colorPrimary: cssVar.blue7 },
          Checkbox: {
            colorPrimary: cssVar.blue7,
            colorText: cssVar.colorTextLightSolid,
          },
          Popover: { colorText: cssVar.colorTextLightSolid },
        },
      }}
    >
      {open ? (
        <div className={styles.container}>
          <div
            style={{
              marginTop: offsetY,
            }}
          >
            <Popover
              arrow={true}
              open={open}
              placement={placement}
              trigger="hover"
              classNames={{
                root: cx(className, styles.overlay),
              }}
              content={
                <Flexbox horizontal gap={24} style={{ userSelect: 'none' }}>
                  <div>{title}</div>
                  <ActionIcon
                    className={styles.close}
                    icon={XIcon}
                    size={'small'}
                    onClick={() => {
                      setOpen(false);
                    }}
                  />
                </Flexbox>
              }
              styles={{
                root: { maxWidth, zIndex: 1000, ...style },
              }}
            >
              {children}
            </Popover>
          </div>
        </div>
      ) : (
        children
      )}
    </ConfigProvider>
  );
};

export default TipGuide;
