import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx"],
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
