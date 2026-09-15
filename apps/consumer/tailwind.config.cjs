const preset = require('@ark/ui/tailwind-preset');

/**
 * Consumer-only Fit tokens. The shared preset stays dark ink/teal so
 * business and Control do not pick this up. `ink` / `signal` are remapped
 * onto these CSS variables so `@ark/ui` Panel, Callout, and DimensionList
 * read as cream/terracotta here without editing the primitives.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  presets: [preset],
  content: [
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        destructive: 'var(--destructive)',
        ink: {
          950: 'var(--background)',
          900: 'var(--background)',
          850: 'var(--card)',
          800: 'var(--muted)',
          700: 'var(--border)',
          600: 'var(--border)',
          500: 'var(--muted-foreground)',
          400: 'var(--muted-foreground)',
          300: 'var(--foreground)',
          200: 'var(--foreground)',
          100: 'var(--foreground)',
        },
        signal: {
          DEFAULT: 'var(--primary)',
          dim: 'var(--primary)',
          glow: 'var(--primary)',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.26rem',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(57, 34, 24, 0.06)',
      },
    },
  },
};
