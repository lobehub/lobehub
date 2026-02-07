import { ActionIcon, Flexbox, Popover } from '@lobehub/ui';
import { ConfigProvider, type TooltipProps } from 'antd';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { XIcon } from 'lucide-react';
import { type CSSProperties, type FC, type ReactNode } from 'react';

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
   * Guide content
   */
  children?: ReactNode;
  /**
   * Class name
   */
  className?: string;
  /**
   * Default open state
   */
  defaultOpen?: boolean;
  /**
   * Render function for customizing the footer section
   */
  footerRender?: (dom: ReactNode) => ReactNode;
  /**
   * Maximum width
   */
  maxWidth?: number;
  /**
   * Vertical offset value
   */
  offsetY?: number;
  /**
   * Callback triggered when the open property changes
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Controlled open property
   */
  open?: boolean;
  /**
   * Tooltip placement, defaults to bottom
   */
  placement?: TooltipProps['placement'];
  /**
   * style
   */
  style?: CSSProperties;
  tip?: boolean;
  /**
   * Guide title
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
              classNames={{
                root: cx(className, styles.overlay),
              }}
              content={
                <Flexbox gap={24} horizontal style={{ userSelect: 'none' }}>
                  <div>{title}</div>
                  <ActionIcon
                    className={styles.close}
                    icon={XIcon}
                    onClick={() => {
                      setOpen(false);
                    }}
                    size={'small'}
                  />
                </Flexbox>
              }
              open={open}
              placement={placement}
              styles={{
                root: { maxWidth, zIndex: 1000, ...style },
              }}
              trigger="hover"
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
