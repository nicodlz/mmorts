import tseslint from "typescript-eslint";
import globals from "globals";
export const gameConfig = [
  { ignores: ["dist/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
