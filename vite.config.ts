import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { license: { fileName: "licenses.md" } },
  test: { include: ["tests/**/*.test.ts"] },
});
