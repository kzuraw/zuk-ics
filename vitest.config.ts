import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

import { testBindings } from "./test/env.ts";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        compatibilityDate: "2026-09-18",
        compatibilityFlags: ["nodejs_compat"],
        bindings: testBindings,
        kvNamespaces: ["CALENDAR_KV"],
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
