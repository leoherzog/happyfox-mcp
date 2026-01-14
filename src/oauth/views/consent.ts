/**
 * Consent Page View
 *
 * Renders the OAuth consent page for collecting HappyFox credentials.
 * Uses Pico CSS v2 for minimal, semantic HTML styling.
 */

import { ConsentPageData, SCOPE_DESCRIPTIONS, HappyFoxScope } from '../types';

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
 * Render the OAuth consent page
 *
 * @param data - Page data including client info, scopes, and form state
 * @returns HTML string
 */
export function renderConsentPage(data: ConsentPageData): string {
  // Build scope list HTML
  const scopeList = data.requestedScopes
    .map(scope => {
      const description = SCOPE_DESCRIPTIONS[scope as HappyFoxScope] || scope;
      return `<li>${escapeHtml(description)}</li>`;
    })
    .join('\n          ');

  // Build error HTML if present
  const errorHtml = data.error
    ? `
      <article aria-invalid="true" style="background-color: var(--pico-del-color); color: white; padding: 1rem; margin-bottom: 1rem;">
        <strong>Error:</strong> ${escapeHtml(data.error)}
      </article>`
    : '';

  // Build client header with optional logo
  const logoHtml = data.logoUri
    ? `<img src="${escapeHtml(data.logoUri)}" alt="${escapeHtml(data.clientName)}" class="client-logo" style="max-height: 48px; margin-bottom: 1rem;">`
    : '';

  const clientLinkHtml = data.clientUri
    ? `<a href="${escapeHtml(data.clientUri)}" target="_blank" rel="noopener">${escapeHtml(data.clientName)}</a>`
    : escapeHtml(data.clientName);

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect to HappyFox</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    :root { --pico-font-size: 16px; }
    .client-header { text-align: center; margin-bottom: 2rem; }
    .scope-list { margin: 1rem 0; padding-left: 1.5rem; }
    .scope-list li { margin: 0.5rem 0; }
    .form-footer { text-align: center; margin-top: 1rem; }
    .security-note { text-align: center; font-size: 0.875rem; opacity: 0.8; margin-top: 2rem; }
  </style>
</head>
<body>
  <main class="container">
    <article>
      <header class="client-header">
        ${logoHtml}
        <h1>Connect to HappyFox</h1>
        <p>
          ${clientLinkHtml}
          is requesting access to your HappyFox account.
        </p>
      </header>

      ${errorHtml}

      <section>
        <p><strong>This will allow ${escapeHtml(data.clientName)} to:</strong></p>
        <ul class="scope-list">
          ${scopeList}
        </ul>
      </section>

      <form method="POST">${data.csrfToken ? `
        <input type="hidden" name="csrf_token" value="${escapeHtml(data.csrfToken)}">` : ''}
        <fieldset>
          <label>
            Account Subdomain
            <input
              type="text"
              name="account_name"
              placeholder="acme"
              value="${escapeHtml(data.formData?.accountName || '')}"
              required
              autocomplete="organization"
              aria-describedby="account-helper"
            >
          </label>
          <small id="account-helper">Your HappyFox URL: https://<strong>subdomain</strong>.happyfox.com</small>

          <label>
            API Key
            <input
              type="password"
              name="api_key"
              placeholder="Enter your API key"
              required
              autocomplete="off"
            >
          </label>

          <label>
            Auth Code
            <input
              type="password"
              name="auth_code"
              placeholder="Enter your auth code"
              required
              autocomplete="off"
              aria-describedby="api-helper"
            >
          </label>
          <small id="api-helper">Find these in HappyFox: Apps &rarr; Goodies &rarr; API</small>

          <label>
            Your Staff Email
            <input
              type="email"
              name="email"
              placeholder="you@company.com"
              value="${escapeHtml(data.formData?.email || '')}"
              required
              autocomplete="email"
              aria-describedby="email-helper"
            >
          </label>
          <small id="email-helper">Must match your email in HappyFox staff settings</small>
        </fieldset>

        <fieldset>
          <legend>Region</legend>
          <label>
            <input
              type="radio"
              name="region"
              value="us"
              ${(data.formData?.region || 'us') === 'us' ? 'checked' : ''}
            >
            US (.happyfox.com)
          </label>
          <label>
            <input
              type="radio"
              name="region"
              value="eu"
              ${data.formData?.region === 'eu' ? 'checked' : ''}
            >
            EU (.happyfox.net)
          </label>
        </fieldset>

        <button type="submit">Connect HappyFox Account</button>

        <footer class="form-footer">
          <a href="javascript:history.back()" role="button" class="secondary outline">Cancel</a>
        </footer>
      </form>

      <footer class="security-note">
        <p>Your credentials are encrypted and stored securely.<br>
        They are never shared with ${escapeHtml(data.clientName)} or third parties.</p>
      </footer>
    </article>
  </main>
  <script>
(function() {
  var form = document.querySelector('form');
  var emailInput = form.querySelector('input[name="email"]');
  var accountInput = form.querySelector('input[name="account_name"]');
  var apiKeyInput = form.querySelector('input[name="api_key"]');
  var authCodeInput = form.querySelector('input[name="auth_code"]');
  var emailHelper = document.getElementById('email-helper');

  // Create status indicator
  var status = document.createElement('span');
  status.id = 'email-status';
  status.style.cssText = 'display:block;margin-top:0.25rem;font-size:0.875rem';
  emailHelper.parentNode.insertBefore(status, emailHelper.nextSibling);

  emailInput.addEventListener('blur', function() {
    var email = emailInput.value.trim();
    var accountName = accountInput.value.trim();
    var apiKey = apiKeyInput.value;
    var authCode = authCodeInput.value;
    var regionEl = form.querySelector('input[name="region"]:checked');
    var region = regionEl ? regionEl.value : 'us';

    // Clear if fields incomplete
    if (!email || !accountName || !apiKey || !authCode) {
      status.textContent = '';
      emailInput.removeAttribute('aria-invalid');
      return;
    }

    status.textContent = 'Checking...';
    status.style.color = 'inherit';

    fetch('/api/validate-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountName: accountName, apiKey: apiKey, authCode: authCode, region: region, email: email })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.valid) {
        status.innerHTML = '\\u2713 Found: <strong>' + escapeHtmlJs(data.staffName) + '</strong>';
        status.style.color = 'var(--pico-ins-color)';
        emailInput.setAttribute('aria-invalid', 'false');
      } else {
        status.textContent = '\\u2717 ' + data.error;
        status.style.color = 'var(--pico-del-color)';
        emailInput.setAttribute('aria-invalid', 'true');
      }
    })
    .catch(function() {
      status.textContent = '\\u2717 Connection error';
      status.style.color = 'var(--pico-del-color)';
    });
  });

  function escapeHtmlJs(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
})();
  </script>
</body>
</html>`;
}

/**
 * Render a simple error page
 *
 * @param title - Error title
 * @param message - Error message
 * @returns HTML string
 */
export function renderErrorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
</head>
<body>
  <main class="container">
    <article>
      <header style="text-align: center;">
        <h1>${escapeHtml(title)}</h1>
      </header>
      <p style="text-align: center;">${escapeHtml(message)}</p>
      <footer style="text-align: center;">
        <a href="javascript:history.back()" role="button" class="secondary">Go Back</a>
      </footer>
    </article>
  </main>
</body>
</html>`;
}

