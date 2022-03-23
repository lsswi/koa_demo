module.exports = {
  parser: '@babel/eslint-parser',
  extends: ['@tencent/eslint-config-tencent', 'eslint:recommended'],
  // plugins: ['babel'],
  globals: {
    // 全局变量 global 不允许被重新赋值
    global: true,
    // 全局变量 plug 不允许被重新赋值
    plug: false,
    // 全局变量 window 不允许被重新赋值
    window: false,
    // 全局变量 context 不允许被重新赋值
    context: false,
  },
  rules: {
    // 强制使用一致的缩进
    indent: [
      'error',
      2,
      {
        // case 子句将相对于 switch 语句缩进 2 个空格
        SwitchCase: 1,
        // 三元表达式内的三元表达式不能有缩进
        flatTernaryExpressions: true,
      },
    ],
    // 不强制使用一致的分号
    // 限制圈复杂度不超过 60
    complexity: [
      'error',
      {
        max: 60,
      },
    ],
    'max-len': ['warn', 180, 2],
    'global-require': 0,
    'import/no-dynamic-require': 0,
    'no-underscore-dangle': 0,
    camelcase: 0,
    'no-console': 0,
    'no-plusplus': 0,
    'require-yield': 0,
    'object-curly-newline': 0,
    'no-param-reassign': 0,
    'newline-per-chained-call': 0,
    semi: 2,
  },
};
