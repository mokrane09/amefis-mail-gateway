const sanitizeHtml = require('sanitize-html');

const DEFAULT_SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'span', 'div', 'b', 'i', 'em', 'strong', 'u', 's', 'strike',
    'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'hr'
  ],
  allowedAttributes: {
    'a': ['href', 'title', 'target'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan'],
    '*': ['style', 'class']
  },
  allowedStyles: {
    '*': {
      'color': [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(/, /^rgba\(/],
      'background-color': [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(/, /^rgba\(/],
      'font-size': [/^\d+(?:px|em|%)$/],
      'font-weight': [/^(?:normal|bold|\d{3})$/],
      'text-align': [/^(?:left|right|center|justify)$/],
      'padding': [/^\d+(?:px|em|%)$/],
      'margin': [/^\d+(?:px|em|%)$/],
      'width': [/^\d+(?:px|em|%)$/],
      'height': [/^\d+(?:px|em|%)$/]
    }
  },
  // Block remote images by default
  transformTags: {
    'img': (tagName, attribs) => {
      // Will be handled by rewriteCidImages
      return { tagName, attribs };
    }
  }
};

function sanitizeEmailHtml(html, allowRemoteImages = false) {
  const options = { ...DEFAULT_SANITIZE_OPTIONS };
  
  if (!allowRemoteImages) {
    // Transform function to block remote images
    options.transformTags = {
      'img': (tagName, attribs) => {
        if (attribs.src && !attribs.src.startsWith('cid:')) {
          // Block remote images
          return {
            tagName: 'span',
            attribs: {
              class: 'blocked-image',
              title: 'Remote image blocked'
            },
            text: '[Image blocked]'
          };
        }
        return { tagName, attribs };
      }
    };
  }
  
  return sanitizeHtml(html, options);
}

function rewriteCidImages(html, cidMap) {
  // cidMap is { cid -> attachmentId }
  // Rewrite cid: references to /attachments/:id?inline=1
  
  let rewritten = html;
  let hasBlockedRemote = false;
  
  for (const [cid, attachmentId] of Object.entries(cidMap)) {
    const cidPattern = new RegExp(`cid:${escapeRegex(cid)}`, 'gi');
    rewritten = rewritten.replace(cidPattern, `/attachments/${attachmentId}?inline=1`);
  }
  
  // Detect if there are any remaining remote images
  if (/<img[^>]+src=["']https?:/.test(rewritten)) {
    hasBlockedRemote = true;
  }
  
  return { html: rewritten, hasBlockedRemote };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPlainText(html) {
  // Strip all HTML tags for plain text
  const text = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {}
  });
  return text.trim();
}

function createSnippet(text, maxLength = 200) {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength) + '...';
}

module.exports = {
  sanitizeEmailHtml,
  rewriteCidImages,
  extractPlainText,
  createSnippet
};

