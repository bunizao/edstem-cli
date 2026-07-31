import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    restoreMocks: true,
    exclude: ["tests/remote/**", "tests/worker/**"],
    include: ["tests/**/*.test.ts"],
  },
});
