import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    edstem: "src/cli.ts",
    "edstem-mcp": "src/mcp.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: ["@bunizao/cli-kit"],
  clean: true,
  sourcemap: false,
  dts: false,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  outExtension: () => ({ js: ".js" }),
  outDir: "dist",
});
