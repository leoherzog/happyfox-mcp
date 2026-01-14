import { describe, it, expect } from 'vitest';
import { renderConsentPage, renderErrorPage } from '../../../../src/oauth/views/consent';
import { ConsentPageData } from '../../../../src/oauth/types';

// Note: escapeHtml is not exported, but we test it indirectly through renderConsentPage/renderErrorPage

describe('renderConsentPage', () => {
  const baseData: ConsentPageData = {
    clientName: 'Test Client',
    requestedScopes: ['happyfox:read'],
  };

  describe('basic rendering', () => {
    it('renders valid HTML document', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en"');
      expect(html).toContain('</html>');
    });

    it('includes page title', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('<title>Connect to HappyFox</title>');
    });

    it('includes Pico CSS stylesheet', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('picocss/pico@2/css/pico.min.css');
    });
  });

  describe('client name rendering', () => {
    it('renders client name in header', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('Test Client');
    });

    it('escapes HTML in client name', () => {
      const data: ConsentPageData = {
        ...baseData,
        clientName: '<script>alert("xss")</script>',
      };
      const html = renderConsentPage(data);
      // Check the malicious content is escaped, not that <script> doesn't exist
      // (the page now has a legitimate script tag for email validation)
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes ampersand in client name', () => {
      const data: ConsentPageData = {
        ...baseData,
        clientName: 'Foo & Bar',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('Foo &amp; Bar');
    });

    it('escapes quotes in client name', () => {
      const data: ConsentPageData = {
        ...baseData,
        clientName: 'Test "Client"',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('Test &quot;Client&quot;');
    });
  });

  describe('client logo', () => {
    it('renders logo when logoUri provided', () => {
      const data: ConsentPageData = {
        ...baseData,
        logoUri: 'https://example.com/logo.png',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('<img src="https://example.com/logo.png"');
      expect(html).toContain('class="client-logo"');
    });

    it('omits logo when logoUri not provided', () => {
      const html = renderConsentPage(baseData);
      expect(html).not.toContain('<img src=');
      expect(html).not.toContain('client-logo');
    });

    it('escapes HTML in logoUri', () => {
      const data: ConsentPageData = {
        ...baseData,
        logoUri: 'https://example.com/logo.png?a=1&b=2',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('src="https://example.com/logo.png?a=1&amp;b=2"');
    });
  });

  describe('client link', () => {
    it('renders link when clientUri provided', () => {
      const data: ConsentPageData = {
        ...baseData,
        clientUri: 'https://example.com',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('<a href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener"');
    });

    it('renders plain text when clientUri not provided', () => {
      const html = renderConsentPage(baseData);
      // Should have client name but not as a link in the header section
      expect(html).toContain('Test Client');
      // The header should not have a link wrapping the client name
      expect(html).not.toMatch(/<a href="[^"]*"[^>]*>Test Client<\/a>\s*is requesting/);
    });

    it('escapes HTML in clientUri', () => {
      const data: ConsentPageData = {
        ...baseData,
        clientUri: 'https://example.com?a=1&b=2',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('href="https://example.com?a=1&amp;b=2"');
    });
  });

  describe('CSRF token', () => {
    it('includes CSRF token hidden field when provided', () => {
      const data: ConsentPageData = {
        ...baseData,
        csrfToken: 'test-csrf-token-123',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('name="csrf_token"');
      expect(html).toContain('value="test-csrf-token-123"');
      expect(html).toContain('type="hidden"');
    });

    it('omits CSRF field when token not provided', () => {
      const html = renderConsentPage(baseData);
      expect(html).not.toContain('name="csrf_token"');
    });

    it('escapes HTML in CSRF token', () => {
      const data: ConsentPageData = {
        ...baseData,
        csrfToken: 'token<script>',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('value="token&lt;script&gt;"');
    });
  });

  describe('error message', () => {
    it('renders error section when error provided', () => {
      const data: ConsentPageData = {
        ...baseData,
        error: 'Invalid credentials',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('Invalid credentials');
    });

    it('omits error section when no error', () => {
      const html = renderConsentPage(baseData);
      expect(html).not.toContain('aria-invalid="true"');
    });

    it('escapes HTML in error message', () => {
      const data: ConsentPageData = {
        ...baseData,
        error: '<script>alert("xss")</script>',
      };
      const html = renderConsentPage(data);
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
    });
  });

  describe('form data persistence', () => {
    it('preserves account name from form data', () => {
      const data: ConsentPageData = {
        ...baseData,
        formData: {
          accountName: 'acme-corp',
        },
      };
      const html = renderConsentPage(data);
      expect(html).toContain('value="acme-corp"');
    });

    it('preserves email from form data', () => {
      const data: ConsentPageData = {
        ...baseData,
        formData: {
          email: 'test@example.com',
        },
      };
      const html = renderConsentPage(data);
      expect(html).toContain('value="test@example.com"');
    });

    it('escapes HTML in form data', () => {
      const data: ConsentPageData = {
        ...baseData,
        formData: {
          accountName: '<script>xss</script>',
          email: 'test@example.com">',
        },
      };
      const html = renderConsentPage(data);
      expect(html).toContain('value="&lt;script&gt;xss&lt;/script&gt;"');
      expect(html).toContain('value="test@example.com&quot;&gt;"');
    });

    it('handles empty form data', () => {
      const data: ConsentPageData = {
        ...baseData,
        formData: {},
      };
      const html = renderConsentPage(data);
      expect(html).toContain('name="account_name"');
      expect(html).toContain('value=""');
    });
  });

  describe('region selection', () => {
    it('defaults to US region when no form data', () => {
      const html = renderConsentPage(baseData);
      expect(html).toMatch(/name="region"\s+value="us"\s+checked/);
      expect(html).not.toMatch(/name="region"\s+value="eu"\s+checked/);
    });

    it('defaults to US region when region not specified in form data', () => {
      const data: ConsentPageData = {
        ...baseData,
        formData: { accountName: 'test' },
      };
      const html = renderConsentPage(data);
      expect(html).toMatch(/name="region"\s+value="us"\s+checked/);
    });

    it('selects EU region when specified in form data', () => {
      const data: ConsentPageData = {
        ...baseData,
        formData: { region: 'eu' },
      };
      const html = renderConsentPage(data);
      expect(html).toMatch(/name="region"\s+value="eu"\s+checked/);
      expect(html).not.toMatch(/name="region"\s+value="us"\s+checked/);
    });

    it('selects US region when explicitly specified', () => {
      const data: ConsentPageData = {
        ...baseData,
        formData: { region: 'us' },
      };
      const html = renderConsentPage(data);
      expect(html).toMatch(/name="region"\s+value="us"\s+checked/);
    });
  });

  describe('scope rendering', () => {
    it('renders single scope with description', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('Read tickets, contacts, and assets');
    });

    it('renders multiple scopes', () => {
      const data: ConsentPageData = {
        ...baseData,
        requestedScopes: ['happyfox:read', 'happyfox:write', 'happyfox:admin'],
      };
      const html = renderConsentPage(data);
      expect(html).toContain('Read tickets, contacts, and assets');
      expect(html).toContain('Create and update tickets, add replies');
      expect(html).toContain('Delete tickets, manage categories');
    });

    it('renders unknown scope as-is', () => {
      const data: ConsentPageData = {
        ...baseData,
        requestedScopes: ['custom:scope'],
      };
      const html = renderConsentPage(data);
      expect(html).toContain('custom:scope');
    });

    it('escapes HTML in scope descriptions', () => {
      const data: ConsentPageData = {
        ...baseData,
        requestedScopes: ['<script>xss</script>'],
      };
      const html = renderConsentPage(data);
      expect(html).toContain('&lt;script&gt;xss&lt;/script&gt;');
    });
  });

  describe('form fields', () => {
    it('includes account_name field', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('name="account_name"');
      expect(html).toContain('type="text"');
      expect(html).toContain('required');
    });

    it('includes api_key field', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('name="api_key"');
      expect(html).toContain('type="password"');
    });

    it('includes auth_code field', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('name="auth_code"');
      expect(html).toContain('type="password"');
    });

    it('includes email field', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('name="email"');
      expect(html).toContain('type="email"');
    });

    it('includes submit button', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('type="submit"');
      expect(html).toContain('Connect HappyFox Account');
    });

    it('includes cancel button', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('history.back()');
      expect(html).toContain('Cancel');
    });
  });

  describe('security footer', () => {
    it('includes security notice', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('credentials are encrypted');
      expect(html).toContain('stored securely');
    });

    it('includes client name in security notice', () => {
      const html = renderConsentPage(baseData);
      expect(html).toContain('never shared with Test Client');
    });
  });
});

describe('renderErrorPage', () => {
  describe('basic rendering', () => {
    it('renders valid HTML document', () => {
      const html = renderErrorPage('Error', 'Something went wrong');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en"');
      expect(html).toContain('</html>');
    });

    it('includes Pico CSS stylesheet', () => {
      const html = renderErrorPage('Error', 'Something went wrong');
      expect(html).toContain('picocss/pico@2/css/pico.min.css');
    });
  });

  describe('title rendering', () => {
    it('renders title in page title tag', () => {
      const html = renderErrorPage('Not Found', 'Page not found');
      expect(html).toContain('<title>Not Found</title>');
    });

    it('renders title in h1 tag', () => {
      const html = renderErrorPage('Not Found', 'Page not found');
      expect(html).toContain('<h1>Not Found</h1>');
    });

    it('escapes HTML in title', () => {
      const html = renderErrorPage('<script>xss</script>', 'Message');
      expect(html).toContain('&lt;script&gt;xss&lt;/script&gt;');
      expect(html).not.toContain('<script>xss</script>');
    });

    it('escapes ampersand in title', () => {
      const html = renderErrorPage('Error & Warning', 'Message');
      expect(html).toContain('Error &amp; Warning');
    });
  });

  describe('message rendering', () => {
    it('renders message in paragraph', () => {
      const html = renderErrorPage('Error', 'Something went wrong');
      expect(html).toContain('<p style="text-align: center;">Something went wrong</p>');
    });

    it('escapes HTML in message', () => {
      const html = renderErrorPage('Error', '<script>alert("xss")</script>');
      expect(html).toContain('&lt;script&gt;alert');
      expect(html).not.toContain('<script>alert');
    });

    it('escapes quotes in message', () => {
      const html = renderErrorPage('Error', 'Click "here" to continue');
      expect(html).toContain('Click &quot;here&quot; to continue');
    });
  });

  describe('navigation', () => {
    it('includes back button', () => {
      const html = renderErrorPage('Error', 'Message');
      expect(html).toContain('history.back()');
      expect(html).toContain('Go Back');
    });

    it('back button has correct styling', () => {
      const html = renderErrorPage('Error', 'Message');
      expect(html).toContain('role="button"');
      expect(html).toContain('class="secondary"');
    });
  });
});
