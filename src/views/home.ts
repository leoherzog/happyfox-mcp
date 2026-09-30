/**
 * Home Page View
 *
 * Renders the read-only landing page served at `/`. Explains what this server
 * is and how to connect an MCP client to it. Uses Pico CSS v2 for styling,
 * matching the OAuth consent page.
 */

import { MCP_PROTOCOL_VERSION } from '../types';
import { AVAILABLE_SCOPES, SCOPE_DESCRIPTIONS } from '../oauth/types';
import { escapeHtml } from './escape-html';

/** Link to HappyFox's guide for generating an API key and auth code */
const HAPPYFOX_API_KEY_DOCS =
  'https://support.happyfox.com/kb/article/476-create-api-key-auth-code-happyfox/';

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
        tickets, contacts, assets, reports and the knowledge base &mdash; using your own HappyFox
        credentials.
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
        <li><strong>API key and auth code</strong> &mdash; created in HappyFox under Apps &rarr; Goodies &rarr; API.
          <a href="${HAPPYFOX_API_KEY_DOCS}" target="_blank" rel="noopener">See HappyFox's guide</a>.</li>
        <li><strong>Your staff email</strong> &mdash; the email of an active agent. Its agent ID becomes
          the default for replies, notes and other actions HappyFox attributes to an agent.</li>
        <li><strong>Region</strong> &mdash; US (<code>.com</code>) or EU (<code>.net</code>) hosting.</li>
        <li><strong>Custom domain</strong> (optional) &mdash; if your account uses one, HappyFox requires
          API calls to go to that domain, so enter its host name, such as <code>support.yourcompany.com</code>.</li>
      </ul>
      <p class="muted">
        The API key and auth code open the whole HappyFox account, not just your own work. Your agent ID
        is a default attribution, not a permission boundary: the assistant may name another agent's ID
        for a call, and HappyFox then applies that agent's role. Grant only the scopes you need.
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
      <p class="muted">
        HappyFox also checks the acting agent's role. Moving tickets to another category needs a move
        permission, deleting assets needs an active agent with Manage Assets, and creating contacts along
        with an asset needs Manage all Contacts. The consent screen warns when you request
        <code>happyfox:admin</code> and your role lacks the move or Manage Assets permission.
      </p>
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
        <li><strong>Reports</strong>: read a saved report's summary, tabular view, response, staff,
          contact and SLA statistics, with optional period filters.</li>
        <li><strong>Knowledge base</strong>: read one article or section.</li>
        <li><strong>Ticket custom fields</strong>: replace a dropdown field's choices account-wide.</li>
      </ul>
      <p><strong>Resources</strong> &mdash; read-only reference data your client can load directly:</p>
      <ul>
        <li><code>happyfox://categories</code>, <code>happyfox://statuses</code>,
          <code>happyfox://priorities</code>, <code>happyfox://staff</code>,
          <code>happyfox://contact-groups</code>,
          <code>happyfox://asset-types</code>, <code>happyfox://ticket-custom-fields</code>,
          <code>happyfox://contact-custom-fields</code>, <code>happyfox://reports</code></li>
        <li>Knowledge base exports: <code>happyfox://kb-articles</code>,
          <code>happyfox://kb-internal-articles</code>, <code>happyfox://kb-sections</code></li>
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
            <td><code><a href="${base}/.well-known/oauth-protected-resource/mcp">/.well-known/oauth-protected-resource/mcp</a></code></td>
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
          data such as categories and statuses is cached for up to 15 minutes to reduce API calls.</li>
        <li>Each time your client refreshes its access token, about hourly, the connection is checked
          against HappyFox. It ends if the key stops working or your agent is deactivated or deleted, and
          at once if HappyFox rejects the key during a request.</li>
        <li>To stop using the connector, remove it from your MCP client. To cut off the key itself,
          turn off the toggle in its edit slider under Apps &rarr; Goodies &rarr; API in
          HappyFox. That stops every integration using the key, so give this connector a key of its own.</li>
      </ul>
    </section>

    <footer class="muted">
      <p>This page is informational only. All functionality is exposed through the MCP endpoint above.</p>
    </footer>
  </main>
</body>
</html>`;
}
