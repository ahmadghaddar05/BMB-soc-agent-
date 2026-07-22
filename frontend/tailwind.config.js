/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--color-bg-canvas)',
        panel: {
          DEFAULT: 'var(--color-panel)',
          raised: 'var(--color-panel-raised)',
          muted: 'var(--color-panel-muted)',
        },
        content: {
          DEFAULT: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
        },
        product: 'var(--color-accent)',
        ai: 'var(--color-ai)',
        dark: {
          900: '#0a0e1a',
          800: '#0f1623',
          700: '#151d2e',
          600: '#1c2638',
          500: '#243044',
        },
        accent: { DEFAULT: '#3b82f6', hover: '#2563eb' },
        sev: {
          critical: '#ef4444',
          high:     '#f97316',
          medium:   '#eab308',
          low:      '#22c55e',
          info:     '#6b7280',
        }
      }
    }
  },
  plugins: [],
};
