// Central configuration for all markdown defaults and asset paths
export const MARKDOWN_CONFIG = {
  EXTENSION: '.md',
  CHUNK_BY_FOLDER: true,
  INCREMENTAL_BY_FOLDER: false,
  PREFIX: 'markdown',
  PURIFY_HTML: true,
  UPDATE_DATE: true,
  COMPRESS: true,
  CONCURRENCY: {
    FOLDERS: 5,
    FILES: 10,
  },
  CACHE: {
    MAX_AGE: 3600, // 1 hour default
  },
} as const;

// Central configuration for asset prefixes - change these to modify where markdown assets are stored/fetched
export const ASSET_PREFIX = {
  build: '/assets/docs', // Where assets are written during build (relative to /public)
  fetch: '/assets/docs', // URL prefix for fetching assets at runtime
} as const;

export const ASSET_ROUTES = {
  docs: (slug: string) => `/forge/docs/${slug}`,
  docsApi: (slug: string) => `/forge/docs/${slug}?api`,
};

// DOMPurify configuration for markdown content
export const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'del',
    'a',
    'img',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'hr',
    'div',
    'span',
  ] as string[],
  ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'id', 'start', 'type', 'colspan', 'rowspan', 'datetime', 'scope', 'data-*'] as string[],
  FORBID_TAGS: ['script', 'object', 'embed', 'form', 'input', 'button', 'iframe', 'frame', 'frameset', 'noframes'] as string[],
  FORBID_ATTR: ['style', 'on*'] as string[],
  KEEP_CONTENT: true,
  ALLOW_DATA_ATTR: false,
};

// Shiki highlighter configuration
export const HIGHLIGHTER_CONFIG = {
  LANGS: ['bash', 'css', 'html', 'javascript', 'json', 'markdown', 'sql', 'text', 'ts', 'tsx', 'typescript', 'xml', 'yaml'] as string[],
  THEMES: ['night-owl'] as string[],
};
