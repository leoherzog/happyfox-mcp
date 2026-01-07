import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityDate: "2024-12-01",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            ALLOWED_ORIGINS: "http://localhost:*,https://localhost:*",
            MCP_SESSION_SECRET: "test-session-secret-key-for-hmac-signing-minimum-32-chars"
          }
        },
        isolatedStorage: true,
      },
    },
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
