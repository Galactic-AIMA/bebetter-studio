/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        carbon: {
          900: '#0A0A0A',
          800: '#141414',
          700: '#1C1C1C',
          600: '#262626',
        },
        bone: {
          500: '#E8E4DC',
          700: '#A39F98',
        },
        gold: {
          500: '#C5A059',
          600: '#B08D4B',
        },
        blood: {
          500: '#8B1A1A',
        },
        neon: {
          red: '#FF3B3B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
