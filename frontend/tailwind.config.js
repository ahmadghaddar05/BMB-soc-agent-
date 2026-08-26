/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-base)',
        panel: {
          DEFAULT: 'var(--bg-surface)',
          raised: 'var(--bg-surface-2)',
          muted: 'var(--bg-surface-2)',
        },
        content: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-tertiary)',
        },
        product: 'var(--accent)',
        accent: { DEFAULT: 'var(--accent)', hover: 'var(--accent)' },
        sev: {
          critical: 'var(--severity-critical)',
          high:     'var(--severity-high)',
          medium:   'var(--severity-medium)',
          low:      'var(--severity-low)',
          info:     'var(--text-secondary)',
        }
      }
    }
  },
  plugins: [],
};
