/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
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
