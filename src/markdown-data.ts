import type { GlobalManifest, MarkdownContent, MarkdownMeta } from './@types/markdown.types';
import { MARKDOWN_CONFIG } from './markdown-config';
import { formatAssetUrl } from './markdown-utils';

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

// In-memory caches for loaded data to avoid multiple file reads
let manifestCache: MarkdownMeta[] | null = null;
let globalManifestCache: GlobalManifest | null = null;
let contentCache: Record<string, MarkdownContent> | null = null;
const folderContentCache: Map<string, Record<string, MarkdownContent>> = new Map();

// ============================================================================
// CORE DATA FETCHING
// ============================================================================

/**
 * Fetch JSON content with smart compression fallback
 * @param url - The URL to fetch from (should be the base .json URL)
 * @param assets - Cloudflare ASSETS binding for static asset serving
 * @returns Parsed JSON content
 */
async function fetchContent<T>(url: string, assets: Fetcher): Promise<T> {
  // Use ASSETS binding for internal asset fetching
  const fetchFn = (input: RequestInfo | URL, init?: RequestInit) => assets.fetch(input, init);

  // Determine URLs for both compressed and uncompressed versions
  const baseUrl = url.endsWith('.gz') ? url.replace('.gz', '') : url;
  const gzUrl = `${baseUrl}.gz`;

  // Try compressed version first
  try {
    const gzResponse = await fetchFn(gzUrl);

    if (gzResponse.ok) {
      // Decompress using Web Streams API
      const compressedData = await gzResponse.arrayBuffer();
      const decompressedStream = new DecompressionStream('gzip');
      const decompressedResponse = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(compressedData));
            controller.close();
          },
        }).pipeThrough(decompressedStream)
      );

      const decompressedText = await decompressedResponse.text();
      const parsed = JSON.parse(decompressedText) as T;
      return parsed;
    }
  } catch (_compressionError) {
    // Compression attempt failed, fall back to uncompressed
  }

  // Fallback to uncompressed version
  try {
    const response = await fetchFn(baseUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const parsed = (await response.json()) as T;
    return parsed;
  } catch (uncompressedError) {
    const errorMsg = `Failed to fetch both compressed (${gzUrl}) and uncompressed (${baseUrl}) versions: ${uncompressedError instanceof Error ? uncompressedError.message : 'Unknown error'}`;
    throw new Error(errorMsg);
  }
}

// ============================================================================
// MANIFEST FUNCTIONS
// ============================================================================

/**
 * Get global manifest data which includes documents and chunking info
 */
async function getGlobalManifest(assets: Fetcher, request?: Request, prefix?: string): Promise<GlobalManifest> {
  if (globalManifestCache) {
    return globalManifestCache;
  }

  try {
    const manifestUrl = formatAssetUrl(`${prefix || MARKDOWN_CONFIG.PREFIX}-manifest.json`, request);
    const globalManifest = await fetchContent<GlobalManifest>(manifestUrl, assets);
    globalManifestCache = globalManifest;
    return globalManifest;
  } catch (_error) {
    return { documents: [], _buildMode: 'single' };
  }
}

/**
 * Get markdown manifest data from generated JSON file
 * This reads from the consumer app's generated manifest file
 */
export async function getMarkdownManifest(assets: Fetcher, request?: Request, prefix?: string): Promise<MarkdownMeta[]> {
  if (manifestCache) {
    return manifestCache;
  }

  const globalManifest = await getGlobalManifest(assets, request, prefix);

  // Filter out build metadata for runtime use
  const cleanManifest = globalManifest.documents.map(({ _mtime, _size, ...item }) => item);

  manifestCache = cleanManifest;
  return cleanManifest;
}

// ============================================================================
// CONTENT FUNCTIONS
// ============================================================================

/**
 * Get markdown content data from generated JSON file
 * This reads from the consumer app's generated content file or folder chunks
 */
export async function getMarkdownContent(assets: Fetcher, request?: Request, prefix?: string): Promise<Record<string, MarkdownContent>> {
  const globalManifest = await getGlobalManifest(assets, request, prefix);

  // In folder chunk mode, we don't preload all content
  if (globalManifest._buildMode === 'chunked') {
    return {};
  }

  if (contentCache) {
    return contentCache;
  }

  try {
    const contentUrl = formatAssetUrl(`${prefix || MARKDOWN_CONFIG.PREFIX}-content.json`, request);
    const content = await fetchContent<Record<string, MarkdownContent>>(contentUrl, assets);
    contentCache = content;
    return content;
  } catch (_error) {
    return {};
  }
}

/**
 * Load content for a specific folder (lazy loading)
 */
async function loadFolderContent(folder: string, assets: Fetcher, request?: Request, prefix?: string): Promise<Record<string, MarkdownContent>> {
  // Check cache first
  if (folderContentCache.has(folder)) {
    const cachedContent = folderContentCache.get(folder);
    if (cachedContent) {
      return cachedContent;
    }
  }

  try {
    const folderKey = folder.replace(/[/\\]/g, '-');
    const contentUrl = formatAssetUrl(`${prefix || MARKDOWN_CONFIG.PREFIX}-content-${folderKey}.json`, request);

    const content = await fetchContent<Record<string, MarkdownContent>>(contentUrl, assets);
    folderContentCache.set(folder, content);
    return content;
  } catch (_error) {
    return {};
  }
}

/**
 * Get a specific markdown document by slug
 */
export async function getMarkdownDocument(slug: string, assets: Fetcher, request?: Request, prefix?: string): Promise<MarkdownContent | null> {
  const globalManifest = await getGlobalManifest(assets, request, prefix);

  // In folder chunk mode, we need to determine which folder the document is in
  if (globalManifest._buildMode === 'chunked') {
    const manifest = await getMarkdownManifest(assets, request, prefix);
    const docMeta = manifest.find(doc => doc.slug === slug);

    if (!docMeta) {
      return null;
    }

    // Documents without a folder are in the root folder
    const folder = docMeta.folder || 'root';
    const folderContent = await loadFolderContent(folder, assets, request, prefix);
    return folderContent[slug] || null;
  }

  // Fallback to traditional mode
  const content = await getMarkdownContent(assets, request, prefix);
  return content[slug] || null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clear the cache (useful for testing or hot reload)
 */
export function clearMarkdownCache(): void {
  manifestCache = null;
  globalManifestCache = null;
  contentCache = null;
  folderContentCache.clear();
}

/**
 * Check if a document exists by slug
 */
export async function hasMarkdownDocument(slug: string, assets: Fetcher, request?: Request, prefix?: string): Promise<boolean> {
  const globalManifest = await getGlobalManifest(assets, request, prefix);

  if (globalManifest._buildMode === 'chunked') {
    const manifest = await getMarkdownManifest(assets, request, prefix);
    return manifest.some(doc => doc.slug === slug);
  }

  const content = await getMarkdownContent(assets, request, prefix);
  return slug in content;
}
