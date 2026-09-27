import DOMPurify from '../../vendor/dompurify/purify.es.mjs';

/** Sanitize untrusted chat HTML before it enters the sidebar DOM. */
export function sanitizeDisplayHtml(value) {
  const html = String(value ?? '');
  const sanitizer = DOMPurify;
  if (typeof sanitizer?.sanitize === 'function') {
    try {
      const clean = sanitizer.sanitize(html, { USE_PROFILES: { html: true } });
      if (typeof clean === 'string') return clean;
    } catch (_error) {
      // A failed sanitizer must not turn into a raw HTML fallback.
    }
  }
  return html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
