declare module "cloudflare:test" {
  interface ProvidedEnv {
    ALLOWED_ORIGINS?: string;
    OAUTH_KV: KVNamespace;
    CREDENTIAL_ENCRYPTION_KEY: string;
    MCP_SESSION_SECRET: string;
  }
}
