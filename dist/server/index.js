import * as v from "valibot";
const MARKDOWN_CONFIG = {
  EXTENSION: ".md",
  CHUNK_BY_FOLDER: true,
  INCREMENTAL_BY_FOLDER: false,
  PREFIX: "markdown",
  PURIFY_HTML: true,
  UPDATE_DATE: true,
  COMPRESS: true,
  CONCURRENCY: {
    FOLDERS: 5,
    FILES: 10
  },
  CACHE: {
    MAX_AGE: 3600
    // 1 hour default
  }
};
const ASSET_PREFIX = {
  // Where assets are written during build (relative to /public)
  fetch: "/assets/docs"
  // URL prefix for fetching assets at runtime
};
v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "Slug cannot be empty"),
  v.regex(/^[a-zA-Z0-9-_/]+$/, "Slug can only contain letters, numbers, hyphens, underscores, and forward slashes"),
  v.check((slug) => !slug.includes(".."), "Directory traversal not allowed"),
  v.check((slug) => !slug.startsWith("/"), "Slug cannot start with forward slash"),
  v.check((slug) => !slug.endsWith("/"), "Slug cannot end with forward slash")
);
function formatAssetUrl(filename, request, prefix) {
  const fetchPrefix = ASSET_PREFIX.fetch;
  const normalizedPrefix = fetchPrefix.endsWith("/") ? fetchPrefix.slice(0, -1) : fetchPrefix;
  const url = `${normalizedPrefix}/${filename}`;
  return request ? new URL(url, request.url).href : url;
}
let manifestCache = null;
let globalManifestCache = null;
let contentCache = null;
const folderContentCache = /* @__PURE__ */ new Map();
async function fetchContent(url, assets) {
  const fetchFn = (input, init) => assets.fetch(input, init);
  const baseUrl = url.endsWith(".gz") ? url.replace(".gz", "") : url;
  const gzUrl = `${baseUrl}.gz`;
  try {
    const gzResponse = await fetchFn(gzUrl);
    if (gzResponse.ok) {
      const compressedData = await gzResponse.arrayBuffer();
      const decompressedStream = new DecompressionStream("gzip");
      const decompressedResponse = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(compressedData));
            controller.close();
          }
        }).pipeThrough(decompressedStream)
      );
      const decompressedText = await decompressedResponse.text();
      const parsed = JSON.parse(decompressedText);
      return parsed;
    }
  } catch (_compressionError) {
  }
  try {
    const response = await fetchFn(baseUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const parsed = await response.json();
    return parsed;
  } catch (uncompressedError) {
    const errorMsg = `Failed to fetch both compressed (${gzUrl}) and uncompressed (${baseUrl}) versions: ${uncompressedError instanceof Error ? uncompressedError.message : "Unknown error"}`;
    throw new Error(errorMsg);
  }
}
async function getGlobalManifest(assets, request, prefix) {
  if (globalManifestCache) {
    return globalManifestCache;
  }
  try {
    const manifestUrl = formatAssetUrl(`${prefix || MARKDOWN_CONFIG.PREFIX}-manifest.json`, request);
    const globalManifest = await fetchContent(manifestUrl, assets);
    globalManifestCache = globalManifest;
    return globalManifest;
  } catch (_error) {
    return { documents: [], _buildMode: "single" };
  }
}
async function getMarkdownManifest(assets, request, prefix) {
  if (manifestCache) {
    return manifestCache;
  }
  const globalManifest = await getGlobalManifest(assets, request, prefix);
  const cleanManifest = globalManifest.documents.map(({ _mtime, _size, ...item }) => item);
  manifestCache = cleanManifest;
  return cleanManifest;
}
async function getMarkdownContent(assets, request, prefix) {
  const globalManifest = await getGlobalManifest(assets, request, prefix);
  if (globalManifest._buildMode === "chunked") {
    return {};
  }
  if (contentCache) {
    return contentCache;
  }
  try {
    const contentUrl = formatAssetUrl(`${prefix || MARKDOWN_CONFIG.PREFIX}-content.json`, request);
    const content = await fetchContent(contentUrl, assets);
    contentCache = content;
    return content;
  } catch (_error) {
    return {};
  }
}
async function loadFolderContent(folder, assets, request, prefix) {
  if (folderContentCache.has(folder)) {
    const cachedContent = folderContentCache.get(folder);
    if (cachedContent) {
      return cachedContent;
    }
  }
  try {
    const folderKey = folder.replace(/[/\\]/g, "-");
    const contentUrl = formatAssetUrl(`${prefix || MARKDOWN_CONFIG.PREFIX}-content-${folderKey}.json`, request);
    const content = await fetchContent(contentUrl, assets);
    folderContentCache.set(folder, content);
    return content;
  } catch (_error) {
    return {};
  }
}
async function getMarkdownDocument(slug, assets, request, prefix) {
  const globalManifest = await getGlobalManifest(assets, request, prefix);
  if (globalManifest._buildMode === "chunked") {
    const manifest = await getMarkdownManifest(assets, request, prefix);
    const docMeta = manifest.find((doc) => doc.slug === slug);
    if (!docMeta) {
      return null;
    }
    const folder = docMeta.folder || "root";
    const folderContent = await loadFolderContent(folder, assets, request, prefix);
    return folderContent[slug] || null;
  }
  const content = await getMarkdownContent(assets, request, prefix);
  return content[slug] || null;
}
async function markdownLoader({ request, ASSETS }) {
  try {
    const manifest = await getMarkdownManifest(ASSETS, request);
    return manifest;
  } catch (_error) {
    return [];
  }
}
async function markdownSlugLoader({ validatedSlug, request, ASSETS }) {
  const url = new URL(request.url);
  const isApiCall = url.searchParams.has("api") || request.headers.get("Accept")?.includes("application/json");
  try {
    const manifest = await getMarkdownManifest(ASSETS, request).catch(() => []);
    const docExists = manifest.some((doc2) => doc2.slug === validatedSlug);
    if (!docExists) {
      throw new Response("Document not found", { status: 404 });
    }
    const doc = await getMarkdownDocument(validatedSlug, ASSETS, request);
    if (!doc) {
      if (isApiCall) {
        throw new Response("Document not found", { status: 404 });
      }
      return { manifest, selectedDoc: validatedSlug, document: null, loading: true };
    }
    const enhancedFrontmatter = {
      ...doc.frontmatter,
      formattedDate: doc.frontmatter.date ? new Date(doc.frontmatter.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : void 0
    };
    if (isApiCall) {
      return Response.json({ content: doc.content, frontmatter: enhancedFrontmatter, slug: validatedSlug });
    }
    const enhancedDoc = { ...doc, frontmatter: enhancedFrontmatter };
    return { manifest, selectedDoc: validatedSlug, document: enhancedDoc };
  } catch (error) {
    if (error instanceof Response && error.status === 404) {
      throw error;
    }
    if (!isApiCall) {
      const manifest = await getMarkdownManifest(ASSETS, request).catch(() => []);
      return { manifest, selectedDoc: validatedSlug, document: null, loading: true };
    }
    throw error;
  }
}
export {
  markdownLoader,
  markdownSlugLoader
};
//# sourceMappingURL=index.js.map
