/** @type {import('tailwindcss').Config} */
// Tokens lifted verbatim from Switchboard Fleet.dc.html — a warm brown-black
// control-room with a blue accent (#5b9ee6, the design's default prop).
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // surfaces (warm brown-black)
        bg: '#100e0a',
        panel: '#16130f', // screen / window
        surface: '#1a1712', // cards, rail, sub-panels
        'surface-2': '#1c1915', // table bg, inner cards, chips
        'surface-3': '#1d1813', // attention card
        head: '#181510', // header bands
        code: '#15120e', // code blocks
        // lines
        line: '#2b2620',
        'line-soft': '#221d17',
        'line-3': '#251f18',
        hair: '#3a342c', // dashed / connector strokes
        // text
        fg: '#efe9dd',
        'fg-2': '#f0ece3',
        t2: '#cdc7ba',
        muted: '#9a9384',
        'muted-2': '#8a8474',
        dim: '#767063',
        'dim-2': '#6f685c',
        'dim-3': '#6e6757',
        faint: '#5d584d',
        // brand accent (blue) — wordmark, primary, toggle-on, links
        brand: { DEFAULT: '#5b9ee6', soft: '#5b9ee6', deep: '#4a8bd4', glow: 'rgba(91,158,230,.16)' },
        copper: { DEFAULT: '#e89b3c', text: '#d8b486' }, // attention / connectors / amber
        // signal palette (from support.js C())
        ok: { DEFAULT: '#5fbf86' },
        run: { DEFAULT: '#5b9ee6' },
        warn: { DEFAULT: '#e6b052' },
        bad: { DEFAULT: '#e5736b' },
        lease: { DEFAULT: '#b49ae6' },
        off: { DEFAULT: '#5d594f' },
        idle: { DEFAULT: '#7f8a80' },
        neutral: { DEFAULT: '#9a93a6' },
      },
      fontFamily: {
        display: ['"Hanken Grotesk Variable"', '"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['"Hanken Grotesk Variable"', '"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { xl: '16px', lg: '13px', md: '9px', sm: '6px' },
      boxShadow: {
        card: '0 28px 80px rgba(0,0,0,.5)',
        pop: '0 16px 48px -12px rgba(0,0,0,.7)',
      },
      keyframes: {
        sbpulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.4' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        sbpulse: 'sbpulse 1.6s ease-in-out infinite',
        'fade-up': 'fade-up 0.35s ease both',
      },
    },
  },
  plugins: [],
};
