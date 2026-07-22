import react from 'eslint-plugin-react';

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        AbortSignal:'readonly', CustomEvent:'readonly', Date:'readonly', Error:'readonly',
        Event:'readonly', JSON:'readonly', Math:'readonly', Number:'readonly', Object:'readonly',
        Promise:'readonly', Response:'readonly', Set:'readonly', String:'readonly', URLSearchParams:'readonly',
        clearInterval:'readonly', clearTimeout:'readonly', console:'readonly', document:'readonly',
        fetch:'readonly', globalThis:'readonly', localStorage:'readonly', navigator:'readonly',
        setInterval:'readonly', setTimeout:'readonly', window:'readonly',
      },
    },
    plugins: { react },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-constant-binary-expression': 'error',
      'react/jsx-no-undef': 'error',
    },
  },
];
