/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Control-room surfaces
        bg: '#0A0D13',
        panel: '#10141D',
        surface: '#141926',
        'surface-2': '#1A2030',
        line: '#222B3D',
        'line-soft': '#1A2233',
        fg: '#E8ECF4',
        muted: '#8A93A7',
        'muted-2': '#5C6577',
        // Brand — iris (used with restraint)
        brand: { DEFAULT: '#8B7CFF', soft: '#A89CFF', deep: '#6F5DF0', glow: 'rgba(139,124,255,0.16)' },
        // Signal palette (status semantics — kept apart from brand)
        ok: { DEFAULT: '#3DD68C', dim: 'rgba(61,214,140,0.14)' },
        run: { DEFAULT: '#5B9DFF', dim: 'rgba(91,157,255,0.14)' },
        warn: { DEFAULT: '#F5B544', dim: 'rgba(245,181,68,0.14)' },
        bad: { DEFAULT: '#FF6B6B', dim: 'rgba(255,107,107,0.14)' },
        neutral: { DEFAULT: '#6B7689', dim: 'rgba(107,118,137,0.14)' },
      },
      fontFamily: {
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { lg: '12px', md: '9px', sm: '6px' },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
        pop: '0 16px 48px -16px rgba(0,0,0,0.7)',
        glow: '0 0 0 1px rgba(139,124,255,0.4), 0 0 24px -6px rgba(139,124,255,0.4)',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '0.7' },
          '70%': { transform: 'scale(2.2)', opacity: '0' },
          '100%': { opacity: '0' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-up': 'fade-up 0.4s ease both',
      },
    },
  },
  plugins: [],
};
