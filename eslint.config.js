import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "test-results/**", "playwright-report/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["server/**/*.js", "*.js"], languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Request: "readonly", Response: "readonly", Headers: "readonly", Buffer: "readonly", AbortSignal: "readonly", fetch: "readonly" } } },
);
