/**
 * One design language across all three surfaces.
 *
 * The consumer app and the business app are the same engine at different
 * depths, so they should not look like different companies. Control is the
 * instrument panel for the same system.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#08090c',
          900: '#0d0f14',
          850: '#12151c',
          800: '#171b24',
          700: '#222836',
          600: '#333b4d',
          500: '#4a5468',
          400: '#6b7689',
          300: '#96a0b2',
          200: '#c3cad6',
          100: '#e6eaf0',
        },
        signal: {
          DEFAULT: '#5eead4',
          dim: '#0f766e',
          glow: '#99f6e4',
        },
        warn: { DEFAULT: '#fbbf24', dim: '#78350f' },
        danger: { DEFAULT: '#f87171', dim: '#7f1d1d' },
        good: { DEFAULT: '#4ade80', dim: '#14532d' },
        info: { DEFAULT: '#818cf8', dim: '#312e81' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: { xl2: '1rem' },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px -12px rgba(0,0,0,0.8)',
      },
    },
  },
};
