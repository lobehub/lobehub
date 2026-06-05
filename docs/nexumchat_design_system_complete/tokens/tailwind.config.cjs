/** nexumChat Tailwind token mapping */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Satoshi Variable', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        surface2: 'var(--color-surface-2)',
        surface3: 'var(--color-surface-3)',
        border: 'var(--color-border)',
        text: 'var(--color-text)',
        muted: 'var(--color-text-muted)',
        subtle: 'var(--color-text-subtle)',
        primary: 'var(--color-primary)',
        accent: 'var(--color-accent)',
        danger: 'var(--color-danger)',
        warning: 'var(--color-warning)',
        success: 'var(--color-success)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)', sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', xl: 'var(--radius-xl)', '2xl': 'var(--radius-2xl)', pill: 'var(--radius-pill)',
      },
      boxShadow: { 1: 'var(--shadow-1)', 2: 'var(--shadow-2)', 3: 'var(--shadow-3)', 4: 'var(--shadow-4)', 5: 'var(--shadow-5)', glow: 'var(--glow-violet)' },
      spacing: { '025':'2px','050':'4px','075':'6px','100':'8px','150':'12px','200':'16px','250':'20px','300':'24px','400':'32px','500':'40px','600':'48px','800':'64px','1000':'80px' },
      screens: { xs:'360px', sm:'640px', md:'768px', lg:'1024px', xl:'1280px', '2xl':'1536px' },
      transitionDuration: { fast:'120ms', base:'180ms', slow:'260ms' },
      transitionTimingFunction: { standard:'cubic-bezier(0.2,0,0,1)', spring:'cubic-bezier(0.16,1,0.3,1)' },
    },
  },
};
