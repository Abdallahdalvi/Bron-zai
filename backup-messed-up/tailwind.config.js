/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts,jsx,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bron: {
          bg: 'hsl(var(--bron-bg) / <alpha-value>)',
          panel: 'hsl(var(--bron-panel) / <alpha-value>)',
          surface: 'hsl(var(--bron-surface) / <alpha-value>)',
          border: 'hsl(var(--bron-border) / <alpha-value>)',
          accent: 'hsl(var(--bron-accent) / <alpha-value>)',
          text: 'var(--bron-text)',
          'text-dim': 'var(--bron-text-dim)',
          'text-muted': 'var(--bron-text-muted)',
          success: 'var(--bron-success)',
          danger: 'var(--bron-danger)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        bron: '10px',
      },
      boxShadow: {
        glow: '0 0 20px rgba(59, 130, 246, 0.15)',
        'glow-lg': '0 0 40px rgba(59, 130, 246, 0.2)',
      },
    },
  },
  plugins: [],
};
