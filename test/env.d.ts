/**
 * Bindings available to tests.
 *
 * `wrangler types` only knows about bindings declared in wrangler.jsonc; the secrets and
 * vars below are supplied by the miniflare block in vitest.config.mts, so they are
 * declared here to keep `env` from "cloudflare:workers" fully typed in tests.
 */
declare namespace Cloudflare {
  /** Types `exports` from "cloudflare:workers" (what `wrangler types` would emit). */
  interface GlobalProps {
    mainModule: typeof import('../src/index');
  }

  interface Env {
    ALLOWED_ORIGINS?: string;
    OAUTH_KV: KVNamespace;
    CREDENTIAL_ENCRYPTION_KEY: string;
  }
}
