/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope Variable', 'system-ui', 'sans-serif'],
        display: ['Unbounded', 'Manrope Variable', 'sans-serif'],
      },
      colors: {
        // «Ирис» — фирменный акцент: индиго-периванкль вместо дефолтного синего
        vovplan: {
          50: '#f0f1ff',
          100: '#e4e6ff',
          200: '#cdd1ff',
          300: '#aab0ff',
          400: '#8187fb',
          500: '#6366f1',
          600: '#5148e0',
          700: '#4338c4',
          800: '#37309c',
          900: '#302d7c',
          950: '#1d1a4b',
        },
      },
    },
  },
  plugins: [],
};
