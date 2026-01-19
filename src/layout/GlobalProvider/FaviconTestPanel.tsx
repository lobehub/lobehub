'use client';

import { memo, useEffect } from 'react';

import { type FaviconState, useFavicon } from './FaviconProvider';

const states: FaviconState[] = ['default', 'progress', 'done', 'error'];

const colors: Record<FaviconState, string> = {
  default: '#888',
  done: '#52c41a',
  error: '#ff4d4f',
  progress: '#faad14',
};

export const FaviconTestPanel = memo(() => {
  const { setFavicon, currentState, isDevMode, setIsDevMode } = useFavicon();

  useEffect(() => {
    // Debug: log all favicon link elements
    const links = document.querySelectorAll('link[rel*="icon"]');
    console.log('[FaviconTestPanel] Found icon links:', links.length);
    links.forEach((link, i) => {
      console.log(`  [${i}] rel="${link.getAttribute('rel')}" href="${link.getAttribute('href')}"`);
    });
  }, []);

  return (
    <div
      style={{
        background: 'rgba(0, 0, 0, 0.85)',
        borderRadius: 8,
        bottom: 80,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        left: 16,
        padding: 12,
        position: 'fixed',
        zIndex: 9999,
      }}
    >
      <div style={{ color: '#fff', fontSize: 12, marginBottom: 4 }}>
        Favicon Test (current: <span style={{ color: colors[currentState] }}>{currentState}</span>)
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {states.map((state) => (
          <button
            key={state}
            onClick={() => setFavicon(state)}
            style={{
              background: currentState === state ? colors[state] : 'transparent',
              border: `2px solid ${colors[state]}`,
              borderRadius: 4,
              color: currentState === state ? '#fff' : colors[state],
              cursor: 'pointer',
              fontSize: 11,
              padding: '4px 8px',
            }}
          >
            {state}
          </button>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #444', marginTop: 4, paddingTop: 8 }}>
        <button
          onClick={() => setIsDevMode(!isDevMode)}
          style={{
            background: isDevMode ? '#1890ff' : '#444',
            border: 'none',
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
            fontSize: 11,
            padding: '4px 8px',
            width: '100%',
          }}
        >
          {isDevMode ? '🔧 Dev' : '🚀 Prod'}
        </button>
      </div>
    </div>
  );
});

FaviconTestPanel.displayName = 'FaviconTestPanel';
