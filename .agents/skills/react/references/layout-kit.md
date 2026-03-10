# Flexbox Layout Components Guide

`@lobehub/ui` provides `Flexbox` and `Center` components for creating flexible layouts.

## Flexbox Component

Flexbox is the most commonly used layout component, similar to CSS `display: flex`.

### Basic Usage

```jsx
import { Flexbox } from '@lobehub/ui';

// Default vertical layout
<Flexbox>
  <div>Child 1</div>
  <div>Child 2</div>
</Flexbox>

// Horizontal layout
<Flexbox horizontal>
  <div>Left</div>
  <div>Right</div>
</Flexbox>
```

### Common Props

- `horizontal`: Boolean, set horizontal direction layout
- `flex`: Number or string, controls flex property
- `gap`: Number, spacing between children
- `align`: Alignment like 'center', 'flex-start', etc.
- `justify`: Main axis alignment like 'space-between', 'center', etc.
- `padding`: Padding value
- `paddingInline`: Horizontal padding
- `paddingBlock`: Vertical padding
- `width/height`: Set dimensions, typically '100%' or specific pixels
- `style`: Custom style object

### Layout Example

```jsx
// Classic three-column layout
<Flexbox horizontal height={'100%'} width={'100%'}>
  {/* Left sidebar */}
  <Flexbox
    width={260}
    style={{
      borderRight: `1px solid ${theme.colorBorderSecondary}`,
      height: '100%',
      overflowY: 'auto',
    }}
  >
    <SidebarContent />
  </Flexbox>

  {/* Center content */}
  <Flexbox flex={1} style={{ height: '100%' }}>
    <Flexbox flex={1} padding={24} style={{ overflowY: 'auto' }}>
      <MainContent />
    </Flexbox>

    {/* Footer */}
    <Flexbox
      style={{
        borderTop: `1px solid ${theme.colorBorderSecondary}`,
        padding: '16px 24px',
      }}
    >
      <Footer />
    </Flexbox>
  </Flexbox>
</Flexbox>
```

## Center Component

Center wraps Flexbox with horizontal and vertical centering.

```jsx
import { Center } from '@lobehub/ui';

<Center width={'100%'} height={'100%'}>
  <Content />
</Center>

// Icon centered
<Center className={styles.icon} flex={'none'} height={40} width={40}>
  <Icon icon={icon} size={24} />
</Center>
```

## Best Practices

- Use `flex={1}` to fill available space
- Use `gap` instead of margin for spacing
- Nest Flexbox for complex layouts
- Set `overflow: 'auto'` for scrollable content
- Use `horizontal` for horizontal layout (default is vertical)
- Combine with `useTheme` hook for theme-responsive layouts
