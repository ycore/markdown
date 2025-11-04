import { jsx, jsxs } from "react/jsx-runtime";
import { SpriteIcon } from "@ycore/componentry/images";
import { LoadingBar } from "@ycore/componentry/impetus";
import { ThemeSwitch } from "@ycore/componentry/impetus/theme";
import { Link } from "@ycore/componentry/vibrant";
import clsx from "clsx";
import { memo, useCallback, useState, useEffect } from "react";
import { useLocation, useNavigate, useFetcher } from "react-router";
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
  build: "/assets/docs",
  // Where assets are written during build (relative to /public)
  fetch: "/assets/docs"
  // URL prefix for fetching assets at runtime
};
const ASSET_ROUTES = {
  docs: (slug) => `/markdown/docs/${slug}`,
  docsApi: (slug) => `/markdown/docs/${slug}?api`
};
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "del",
    "a",
    "img",
    "ul",
    "ol",
    "li",
    "blockquote",
    "pre",
    "code",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "hr",
    "div",
    "span"
  ],
  ALLOWED_ATTR: ["href", "title", "alt", "src", "class", "id", "start", "type", "colspan", "rowspan", "datetime", "scope", "data-*"],
  FORBID_TAGS: ["script", "object", "embed", "form", "input", "button", "iframe", "frame", "frameset", "noframes"],
  FORBID_ATTR: ["style", "on*"],
  KEEP_CONTENT: true,
  ALLOW_DATA_ATTR: false
};
const HIGHLIGHTER_CONFIG = {
  LANGS: ["bash", "css", "html", "javascript", "json", "markdown", "sql", "text", "ts", "tsx", "typescript", "xml", "yaml"],
  THEMES: ["night-owl"]
};
function MarkdownRenderer({ children, className = "" }) {
  if (!children || typeof children !== "string") {
    return /* @__PURE__ */ jsx("div", { className });
  }
  return /* @__PURE__ */ jsx("div", { className, dangerouslySetInnerHTML: { __html: children } });
}
const isDocContent = (data) => {
  return typeof data === "object" && data !== null && "content" in data && "frontmatter" in data && "slug" in data;
};
const isMarkdownPageData = (data) => {
  return typeof data === "object" && data !== null && "manifest" in data;
};
function MarkdownPage({ loaderData, spriteUrl }) {
  const pageData = isMarkdownPageData(loaderData) ? loaderData : { manifest: loaderData, selectedDoc: void 0, document: void 0 };
  const { manifest: docs, selectedDoc: preloadedDoc, document: preloadedDocument, loading: serverLoading } = pageData;
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedDoc, setSelectedDoc] = useState(preloadedDoc || null);
  const [error, setError] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fetcher = useFetcher();
  const handleDocSelect = useCallback(
    (slug) => {
      if (selectedDoc === slug) return;
      navigate(ASSET_ROUTES.docs(slug));
    },
    [selectedDoc, navigate]
  );
  useEffect(() => {
    if (preloadedDoc && preloadedDoc !== selectedDoc) {
      setSelectedDoc(preloadedDoc);
      setError(null);
    } else {
      const pathParts = location.pathname.split("/");
      const docsIndex = pathParts.indexOf("docs");
      if (docsIndex !== -1 && docsIndex < pathParts.length - 1) {
        const slug = pathParts.slice(docsIndex + 1).join("/");
        if (slug && docs.find((doc) => doc.slug === slug) && selectedDoc !== slug) {
          setSelectedDoc(slug);
          if (!preloadedDocument || preloadedDoc !== slug) {
            fetcher.load(ASSET_ROUTES.docsApi(slug));
          }
        }
      } else if (selectedDoc && !preloadedDoc) {
        setSelectedDoc(null);
        setError(null);
      }
    }
  }, [docs, fetcher.load, selectedDoc, location.pathname, preloadedDoc, preloadedDocument]);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !isDocContent(fetcher.data)) {
      setError("Failed to load document");
    }
  }, [fetcher.state, fetcher.data]);
  const currentDoc = preloadedDocument && preloadedDoc === selectedDoc ? { content: preloadedDocument.content, frontmatter: preloadedDocument.frontmatter } : isDocContent(fetcher.data) ? fetcher.data : void 0;
  return /* @__PURE__ */ jsx("div", { className: "min-h-screen bg-white transition-colors dark:bg-gray-900", children: /* @__PURE__ */ jsxs("div", { className: "flex", children: [
    /* @__PURE__ */ jsxs(
      "aside",
      {
        className: `fixed inset-y-0 top-0 left-0 z-20 flex w-80 flex-col border-gray-200 border-r bg-white transition-transform duration-300 dark:border-gray-800 dark:bg-gray-900 ${sidebarCollapsed ? "-translate-x-full" : "translate-x-0"}`,
        children: [
          /* @__PURE__ */ jsxs("div", { className: "flex-1 overflow-y-auto p-6 pb-20", children: [
            /* @__PURE__ */ jsxs("div", { className: "mb-6 flex items-center justify-between", children: [
              /* @__PURE__ */ jsx("h2", { className: "font-semibold text-gray-900 text-lg dark:text-white", children: "Documentation" }),
              /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setSidebarCollapsed(!sidebarCollapsed), className: "rounded-md p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200", children: /* @__PURE__ */ jsx(SpriteIcon, { spriteUrl, iconId: "ChevronLeft", className: "h-5 w-5" }) }) })
            ] }),
            /* @__PURE__ */ jsx("nav", { className: "space-y-1", "aria-label": "Documentation navigation", children: docs.length === 0 ? /* @__PURE__ */ jsx(DocListEmpty, {}) : /* @__PURE__ */ jsx(DocList, { docs, selectedDoc, onDocSelect: handleDocSelect, spriteUrl }) })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "border-gray-200/50 border-t p-4 backdrop-blur-sm dark:border-gray-800/50", children: /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-end gap-x-3", children: [
            /* @__PURE__ */ jsx(Link, { href: "/", children: /* @__PURE__ */ jsx(SpriteIcon, { spriteUrl, iconId: "House", className: "size-5 text-accent-foreground transition-colors hover:text-accent-foreground/80", viewBox: "0 0 24 24" }) }),
            /* @__PURE__ */ jsx(ThemeSwitch, { spriteUrl })
          ] }) })
        ]
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick: () => setSidebarCollapsed(false),
        className: `fixed top-4 left-4 z-30 rounded-md border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition-opacity duration-300 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-gray-200 ${sidebarCollapsed ? "opacity-100" : "pointer-events-none opacity-0"}`,
        children: /* @__PURE__ */ jsx(SpriteIcon, { spriteUrl, iconId: "EllipsisVertical", className: "h-5 w-5" })
      }
    ),
    /* @__PURE__ */ jsx("main", { className: `flex-1 transition-all duration-300 ${sidebarCollapsed ? "pl-0" : "pl-64"} min-w-0`, children: /* @__PURE__ */ jsx("div", { className: "mx-auto min-w-0 max-w-4xl px-4 md:px-8", children: !selectedDoc ? /* @__PURE__ */ jsx("div", { className: "flex h-96 items-center justify-center", children: /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
      /* @__PURE__ */ jsx("div", { className: "mb-4 text-gray-400 dark:text-gray-500", children: /* @__PURE__ */ jsx(SpriteIcon, { spriteUrl, iconId: "CircleAlert", className: "h-8 w-8" }) }),
      /* @__PURE__ */ jsx("h3", { className: "mb-2 font-medium text-gray-900 text-lg dark:text-white", children: "Select a document" }),
      /* @__PURE__ */ jsx("p", { className: "text-gray-500 dark:text-gray-400", children: "Choose a document from the sidebar to view its content." })
    ] }) }) : fetcher.state === "loading" || serverLoading || selectedDoc && !currentDoc && !error ? /* @__PURE__ */ jsx(LoadingBar, {}) : error ? /* @__PURE__ */ jsx(DocumentNotFound, { spriteUrl }) : currentDoc ? /* @__PURE__ */ jsxs("article", { className: "markdown-content min-w-0 py-8 md:py-12", children: [
      /* @__PURE__ */ jsx(DocumentHeader, { frontmatter: currentDoc.frontmatter }),
      /* @__PURE__ */ jsx(MarkdownRenderer, { className: "min-w-0 max-w-none", children: currentDoc.content })
    ] }) : /* @__PURE__ */ jsx(DocumentNotFound, { spriteUrl }) }) })
  ] }) });
}
const DocListEmpty = () => {
  return /* @__PURE__ */ jsx("p", { className: "text-gray-500 text-sm dark:text-gray-400", children: "No documentation found." });
};
const DocumentNotFound = memo(({ spriteUrl }) => /* @__PURE__ */ jsx("div", { className: "flex h-96 items-center justify-center", children: /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
  /* @__PURE__ */ jsx("div", { className: "mb-4 text-red-400 dark:text-red-500", children: /* @__PURE__ */ jsx(SpriteIcon, { spriteUrl, iconId: "CircleAlert", className: "mx-auto h-8 w-8" }) }),
  /* @__PURE__ */ jsx("h3", { className: "mb-2 font-medium text-gray-900 text-lg dark:text-white", children: "Document not found" }),
  /* @__PURE__ */ jsx("p", { className: "text-gray-500 dark:text-gray-400", children: "The selected document could not be loaded." })
] }) }));
const DocumentHeader = memo(({ frontmatter }) => /* @__PURE__ */ jsxs("header", { className: "mb-8", children: [
  frontmatter.title && /* @__PURE__ */ jsx("h1", { className: "mb-4 font-bold font-serif text-3xl text-gray-900 dark:text-white", children: frontmatter.title }),
  frontmatter.description && /* @__PURE__ */ jsx("p", { className: "mb-4 font-serif text-gray-600 text-lg dark:text-gray-300", children: frontmatter.description }),
  (frontmatter.formattedDate || frontmatter.version) && /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between text-gray-500 text-sm dark:text-gray-400", children: [
    frontmatter.formattedDate && /* @__PURE__ */ jsx("time", { className: "font-sans", dateTime: frontmatter.date, children: frontmatter.formattedDate }),
    frontmatter.version && /* @__PURE__ */ jsx("span", { className: "px-2 py-1 font-mono text-gray-300 text-xs italic dark:text-gray-600", children: frontmatter.version })
  ] })
] }));
const DocList = memo(({ docs, selectedDoc, onDocSelect, spriteUrl }) => {
  const groupedDocs = useCallback(() => {
    const groups2 = {};
    for (const doc of docs) {
      const folder = doc.folder || "";
      if (!groups2[folder]) {
        groups2[folder] = [];
      }
      groups2[folder].push(doc);
    }
    return groups2;
  }, [docs]);
  const groups = groupedDocs();
  return /* @__PURE__ */ jsx("div", { className: "space-y-1", children: Object.entries(groups).map(([folder, folderDocs]) => {
    const isRootLevel = folder === "";
    const folderId = `folder-${folder.replace(/[^a-zA-Z0-9]/g, "-")}`;
    return /* @__PURE__ */ jsxs("div", { children: [
      !isRootLevel && /* @__PURE__ */ jsxs("div", { className: "relative", children: [
        /* @__PURE__ */ jsx("input", { type: "checkbox", id: folderId, className: "peer hidden", defaultChecked: true }),
        /* @__PURE__ */ jsxs("label", { htmlFor: folderId, className: "flex w-full cursor-pointer items-center px-3 py-2 text-left text-gray-600 text-sm transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50", children: [
          /* @__PURE__ */ jsx(SpriteIcon, { spriteUrl, iconId: "ChevronRight", className: "mr-2 h-3 w-3 transition-transform duration-200 peer-checked:rotate-90" }),
          /* @__PURE__ */ jsx("span", { className: "font-medium capitalize", children: folder })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "ml-6 max-h-0 space-y-0.5 overflow-hidden transition-all duration-300 peer-checked:max-h-96", children: folderDocs.map((doc) => /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => onDocSelect(doc.slug),
            className: clsx(
              "w-full px-3 py-2 text-left text-sm transition-colors focus:outline-none",
              selectedDoc === doc.slug ? "border-blue-500 border-r-2 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-100" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50"
            ),
            children: /* @__PURE__ */ jsx("div", { className: "flex items-center", children: /* @__PURE__ */ jsx("div", { className: "flex-1", children: /* @__PURE__ */ jsx("div", { className: "font-medium", children: doc.title || doc.slug }) }) })
          },
          doc.slug
        )) })
      ] }),
      isRootLevel && /* @__PURE__ */ jsx("div", { className: "space-y-0.5", children: folderDocs.map((doc) => /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onClick: () => onDocSelect(doc.slug),
          className: clsx(
            "w-full px-3 py-2 text-left text-sm transition-colors focus:outline-none",
            selectedDoc === doc.slug ? "border-blue-500 border-r-2 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-100" : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50"
          ),
          children: /* @__PURE__ */ jsx("div", { className: "font-medium", children: doc.title || doc.slug })
        },
        doc.slug
      )) })
    ] }, folder || "root");
  }) });
});
const documentSlugSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "Slug cannot be empty"),
  v.regex(/^[a-zA-Z0-9-_/]+$/, "Slug can only contain letters, numbers, hyphens, underscores, and forward slashes"),
  v.check((slug) => !slug.includes(".."), "Directory traversal not allowed"),
  v.check((slug) => !slug.startsWith("/"), "Slug cannot start with forward slash"),
  v.check((slug) => !slug.endsWith("/"), "Slug cannot end with forward slash")
);
function validateDocumentSlug(slug) {
  try {
    return v.parse(documentSlugSchema, slug);
  } catch (error) {
    if (error instanceof v.ValiError) {
      const message = error.issues[0]?.message || "Invalid document url";
      throw new Response(message, { status: 400 });
    }
    throw new Response("Invalid document slug", { status: 400 });
  }
}
function formatAssetUrl(filename, request, prefix) {
  const fetchPrefix = prefix || ASSET_PREFIX.fetch;
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
function clearMarkdownCache() {
  manifestCache = null;
  globalManifestCache = null;
  contentCache = null;
  folderContentCache.clear();
}
async function hasMarkdownDocument(slug, assets, request, prefix) {
  const globalManifest = await getGlobalManifest(assets, request, prefix);
  if (globalManifest._buildMode === "chunked") {
    const manifest = await getMarkdownManifest(assets, request, prefix);
    return manifest.some((doc) => doc.slug === slug);
  }
  const content = await getMarkdownContent(assets, request, prefix);
  return slug in content;
}
export {
  ASSET_PREFIX,
  ASSET_ROUTES,
  DOMPURIFY_CONFIG,
  HIGHLIGHTER_CONFIG,
  MARKDOWN_CONFIG,
  MarkdownPage,
  MarkdownRenderer,
  clearMarkdownCache,
  formatAssetUrl,
  getMarkdownContent,
  getMarkdownDocument,
  getMarkdownManifest,
  hasMarkdownDocument,
  validateDocumentSlug
};
//# sourceMappingURL=index.js.map
