import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ALLOWED_ORIGINS: "http://localhost:*,https://localhost:*",
          MCP_SESSION_SECRET: "test-session-secret-key-for-hmac-signing-minimum-32-chars",
          // base64 of the 32 bytes "12345678901234567890123456789012"
          CREDENTIAL_ENCRYPTION_KEY: "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
        },
        kvNamespaces: ["OAUTH_KV"]
      },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts"
      ],
      reporter: ["text", "html", "json", "lcov"],
      reportsDirectory: "./coverage",
    },
    include: ["test/**/*.test.ts"],
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
