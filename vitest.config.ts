import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    restoreMocks: true,
    exclude: ["tests/cloudflare/**", "tests/remote/**"],
    include: ["tests/**/*.test.ts"],
  },
});
