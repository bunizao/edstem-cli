import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    restoreMocks: true,
    include: ["tests/**/*.test.ts"],
  },
});
