/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom color palette for EchoRoom
        primary: {
          50: '#e6f0fa',
          100: '#cce1f5',
          200: '#99c3eb',
          300: '#66a5e1',
          400: '#4a90d9',
          500: '#3380cc',
          600: '#2966a3',
          700: '#1f4d7a',
          800: '#143352',
          900: '#0a1a29',
        },
        dark: {
          50: '#e8e8ec',
          100: '#d1d1d9',
          200: '#a3a3b3',
          300: '#75758d',
          400: '#474767',
          500: '#2d2d44',
          600: '#1a1a2e',
          700: '#141424',
          800: '#0e0e1a',
          900: '#080810',
        },
        accent: {
          50: '#e6fbf6',
          100: '#ccf7ed',
          200: '#99efdb',
          300: '#66e7c9',
          400: '#33dfb7',
          500: '#00d4aa',
          600: '#00aa88',
          700: '#008066',
          800: '#005544',
          900: '#002b22',
        },
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        info: '#3b82f6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'wave': 'wave 1.5s ease-in-out infinite',
        'ripple': 'ripple 1s ease-out forwards',
      },
      keyframes: {
        wave: {
          '0%, 100%': { transform: 'scaleY(1)' },
          '50%': { transform: 'scaleY(0.5)' },
        },
        ripple: {
          '0%': { transform: 'scale(0)', opacity: '1' },
          '100%': { transform: 'scale(4)', opacity: '0' },
        }
      }
    },
  },
  plugins: [],
}
