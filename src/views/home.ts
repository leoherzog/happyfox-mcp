/**
 * Home Page View
 *
 * Renders the read-only landing page served at `/`. Explains what this server
 * is and how to connect an MCP client to it. Uses Pico CSS v2 for styling,
 * matching the OAuth consent page.
 */

import { MCP_PROTOCOL_VERSION } from '../types';
import { AVAILABLE_SCOPES, SCOPE_DESCRIPTIONS } from '../oauth/types';

/** Link to HappyFox's guide for generating an API key and auth code */
const HAPPYFOX_API_KEY_DOCS =
  'https://support.happyfox.com/kb/article/476-create-api-key-auth-code-happyfox/';

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render the home page
 *
 * @param origin - Public origin of this deployment (e.g. https://happyfox-mcp.example.workers.dev)
 * @returns HTML string
 */
export function renderHomePage(origin: string): string {
  const base = escapeHtml(origin.replace(/\/+$/, ''));

  const scopeRows = AVAILABLE_SCOPES.map(scope => `
        <tr>
          <td><code>${escapeHtml(scope)}</code></td>
          <td>${escapeHtml(SCOPE_DESCRIPTIONS[scope])}</td>
        </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HappyFox MCP Adapter</title>
  <meta name="description" content="A Model Context Protocol server that connects MCP clients to the HappyFox helpdesk API.">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    :root { --pico-font-size: 16px; }
    header.page-header { text-align: center; margin-bottom: 2rem; }
    .endpoint { display: block; padding: 0.75rem 1rem; text-align: center; word-break: break-all; }
    .muted { opacity: 0.8; font-size: 0.875rem; }
    td code, li code { white-space: nowrap; }
  </style>
</head>
<body>
  <main class="container">
    <header class="page-header">
      <h1>HappyFox MCP Adapter</h1>
      <p>
        A <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener">Model Context Protocol</a>
        server that lets AI assistants work with your HappyFox helpdesk &mdash;
        tickets, contacts, and assets &mdash; using your own HappyFox credentials.
      </p>
      <code class="endpoint">${base}/mcp</code>
    </header>

    <article>
      <header><strong>Getting started</strong></header>
      <ol>
        <li>
          Add <code>${base}/mcp</code> as a custom connector (remote MCP server) in your
          MCP client, such as Claude.
        </li>
        <li>
          Your client registers itself and sends you here to sign in. Enter your HappyFox
          details on the consent screen and approve the access you want to grant.
        </li>
        <li>
          That's it &mdash; ask your assistant to search tickets, reply to a customer, or look up
          an asset.
        </li>
      </ol>
      <p class="muted">
        This server speaks MCP <code>${escapeHtml(MCP_PROTOCOL_VERSION)}</code> over stateless
        Streamable HTTP and authenticates with OAuth 2.0 + PKCE. There is nothing to install and no
        account to create here &mdash; it is a thin bridge to the HappyFox API.
      </p>
    </article>

    <section>
      <h2>What you'll need</h2>
      <ul>
        <li><strong>Account subdomain</strong> &mdash; the <code>yourcompany</code> in <code>yourcompany.happyfox.com</code>.</li>
        <li><strong>API key and auth code</strong> &mdash; generated in HappyFox.
          <a href="${HAPPYFOX_API_KEY_DOCS}" target="_blank" rel="noopener">See HappyFox's guide</a>.</li>
        <li><strong>Your staff email</strong> &mdash; used to look up your agent ID, so replies and
          notes are attributed to you.</li>
        <li><strong>Region</strong> &mdash; US (<code>.com</code>) or EU (<code>.net</code>) hosting.</li>
      </ul>
      <p class="muted">
        Everything the assistant can do is limited by your own HappyFox permissions.
      </p>
    </section>

    <section>
      <h2>Access scopes</h2>
      <p>You choose which of these to grant when you connect:</p>
      <table>
        <thead>
          <tr><th scope="col">Scope</th><th scope="col">Allows</th></tr>
        </thead>
        <tbody>${scopeRows}
        </tbody>
      </table>
    </section>

    <section>
      <h2>What's available</h2>
      <p><strong>Tools</strong> &mdash; actions the assistant can take:</p>
      <ul>
        <li><strong>Tickets</strong>: search and read, create, update, reply, add private notes,
          forward, tag, move category, delete.</li>
        <li><strong>Contacts &amp; groups</strong>: search and read, create, update, manage group
          membership.</li>
        <li><strong>Assets</strong>: search and read, create, update, delete, inspect custom fields.</li>
      </ul>
      <p><strong>Resources</strong> &mdash; read-only reference data your client can load directly:</p>
      <ul>
        <li><code>happyfox://categories</code>, <code>happyfox://statuses</code>,
          <code>happyfox://staff</code>, <code>happyfox://contact-groups</code>,
          <code>happyfox://asset-types</code>, <code>happyfox://ticket-custom-fields</code>,
          <code>happyfox://contact-custom-fields</code></li>
      </ul>
      <p class="muted">File attachments are not supported.</p>
    </section>

    <section>
      <h2>Endpoints</h2>
      <table>
        <thead>
          <tr><th scope="col">Path</th><th scope="col">Purpose</th></tr>
        </thead>
        <tbody>
          <tr><td><code>/mcp</code></td><td>MCP Streamable HTTP endpoint (POST, Bearer token required)</td></tr>
          <tr><td><code>/authorize</code></td><td>OAuth authorization and consent screen</td></tr>
          <tr><td><code>/oauth/token</code></td><td>OAuth token exchange</td></tr>
          <tr>
            <td><code><a href="${base}/.well-known/oauth-authorization-server">/.well-known/oauth-authorization-server</a></code></td>
            <td>Authorization server metadata (RFC 8414)</td>
          </tr>
          <tr>
            <td><code><a href="${base}/.well-known/oauth-protected-resource">/.well-known/oauth-protected-resource</a></code></td>
            <td>Protected resource metadata (RFC 9728)</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>How your credentials are handled</h2>
      <ul>
        <li>Your API key and auth code are encrypted (AES-256-GCM) and stored only for the life of
          your authorization.</li>
        <li>Requests go straight to your HappyFox account; ticket data is not stored here. Reference
          data such as categories and statuses is cached briefly to reduce API calls.</li>
        <li>Revoke access at any time by deleting the connector in your MCP client or rotating your
          HappyFox API key.</li>
      </ul>
    </section>

    <footer class="muted">
      <p>This page is informational only. All functionality is exposed through the MCP endpoint above.</p>
    </footer>
  </main>
</body>
</html>`;
}
