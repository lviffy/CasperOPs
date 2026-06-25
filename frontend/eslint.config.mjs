import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Playwright spec files use test/expect globals + Node-style imports.
  {
    files: ["e2e/**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
    },
  },
  // Generated artefacts and Playwright output — don't lint.
  {
    ignores: [
      ".next/**",
      "playwright-report/**",
      "test-results/**",
      "e2e/fixtures/**",
    ],
  },
];

export default eslintConfig;
