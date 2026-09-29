/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', '"Apple SD Gothic Neo"', '"Noto Sans KR"', '"Malgun Gothic"', 'sans-serif'],
      },
      colors: {
        accent: {
          DEFAULT: '#4F46E5',
          light: '#EEF2FF',
          tint: '#C7D2FE',
        },
      },
    },
  },
  plugins: [],
}
