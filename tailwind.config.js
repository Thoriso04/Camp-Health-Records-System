/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          600: '#4f46e5',
          700: '#4338ca',
        },
        paper: '#F7F5F1',
        ink: '#1C1B1A',
        clinical: {
          50: '#EAF1F3',
          100: '#D2E1E6',
          400: '#4A7F94',
          500: '#2B5F75',
          600: '#204A5C',
          700: '#173845',
          DEFAULT: '#2B5F75',
        },
        alert: {
          50: '#FBEAE9',
          100: '#F5CFCC',
          500: '#B3261E',
          600: '#8C1D17',
          DEFAULT: '#B3261E',
        },
        amber: {
          50: '#FDF3E0',
          500: '#B87503',
          600: '#8F5A02',
          DEFAULT: '#B87503',
        },
        confirm: {
          50: '#E8F5EC',
          500: '#2E7D4F',
          600: '#1F5C38',
          DEFAULT: '#2E7D4F',
        },
        slate: {
          100: '#EDEBE7',
          300: '#C7C2BA',
          500: '#8A857D',
          700: '#5C584F',
          DEFAULT: '#8A857D',
        },
        // Sampled directly from the real Camp Footprints logo
        // (Camper Registration and Indemnity forms.pdf, page 1).
        // Used for brand moments (header, primary actions) — NOT for
        // safety-critical states. alert/confirm/amber stay as they are
        // regardless of brand, since those carry clinical meaning that
        // must never be reinterpreted for aesthetics.
        footprints: {
          50: '#F3EFEA',
          100: '#E6DCD0',
          400: '#A8947C',
          600: '#6D6250',
          700: '#4F4739',
          DEFAULT: '#6D6250',
        },
        lime: {
          50: '#F4F9DE',
          400: '#AFCB05',
          600: '#6B7A03',
          DEFAULT: '#AFCB05',
        },
      },
      fontFamily: {
        sans: ['"Work Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '6px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(28, 27, 26, 0.06), 0 1px 3px rgba(28, 27, 26, 0.08)',
      },
    },
  },
  plugins: [],
}