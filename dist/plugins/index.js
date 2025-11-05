import { existsSync } from "node:fs";
import { stat, readFile, mkdir, writeFile, readdir, utimes } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import { createHighlighter } from "shiki";
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
  }
};
const ASSET_PREFIX = {
  build: "/assets/docs"
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
function getAssetPath(filename, prefix) {
  const buildPrefix = prefix || ASSET_PREFIX.build;
  const normalizedPrefix = buildPrefix.startsWith("/") ? buildPrefix.slice(1) : buildPrefix;
  return path.join(process.cwd(), "public", normalizedPrefix, filename);
}
const gzipAsync = promisify(gzip);
function markdownBuilder(options) {
  const {
    source,
    extension = MARKDOWN_CONFIG.EXTENSION,
    chunkByFolder = MARKDOWN_CONFIG.CHUNK_BY_FOLDER,
    incrementalByFolder = MARKDOWN_CONFIG.INCREMENTAL_BY_FOLDER,
    prefix = MARKDOWN_CONFIG.PREFIX,
    purifyHtml = MARKDOWN_CONFIG.PURIFY_HTML,
    shikiConfig,
    syntaxHighlighter,
    updateDate = MARKDOWN_CONFIG.UPDATE_DATE,
    compress = MARKDOWN_CONFIG.COMPRESS
  } = options;
  let highlighter = null;
  let isInitialized = false;
  async function updateFrontmatterDate(filePath, content, fileMtime) {
    if (!updateDate) return content;
    const { data: frontmatter, content: markdown } = parseFrontmatter(content);
    const fileDate = new Date(fileMtime).toISOString().split("T")[0];
    if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) return content;
    if (frontmatter.date === fileDate) return content;
    const updatedFrontmatter = { ...frontmatter, date: fileDate };
    const frontmatterStr = Object.entries(updatedFrontmatter).map(([key, value]) => `${key}: ${typeof value === "string" ? `"${value}"` : value}`).join("\n");
    const updatedContent = `---
${frontmatterStr}
---
${markdown}`;
    try {
      await writeFile(filePath, updatedContent);
      const originalDate = new Date(fileMtime);
      await utimes(filePath, originalDate, originalDate);
      console.info(`📅 Updated frontmatter date in ${filePath} to match file`);
      return updatedContent;
    } catch (error) {
      console.warn(`⚠️ Failed to update date in ${filePath}:`, error);
      return content;
    }
  }
  async function initializeHighlighter() {
    if (isInitialized) return;
    if (syntaxHighlighter === null) {
      highlighter = null;
    } else if (syntaxHighlighter) {
      highlighter = syntaxHighlighter;
    } else {
      try {
        highlighter = await createShikiHighlighter(shikiConfig);
      } catch (error) {
        console.warn("⚠️ Failed to initialize Shiki highlighter:", error);
        highlighter = null;
      }
    }
    isInitialized = true;
  }
  async function collectMarkdownFilesWithMetadata(dir) {
    const result = /* @__PURE__ */ new Map();
    async function walk(current) {
      const entries = await readdir(current, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) return walk(full);
          if (!entry.name.endsWith(extension)) return;
          const stats = await stat(full);
          const rel = path.relative(dir, full);
          result.set(rel, { path: full, metadata: { mtime: stats.mtime.getTime(), size: stats.size } });
        })
      );
    }
    await walk(dir);
    return result;
  }
  async function collectFilesByFolder(dir) {
    const folderMap = /* @__PURE__ */ new Map();
    const files = await collectMarkdownFilesWithMetadata(dir);
    for (const [relPath, fileInfo] of files) {
      const folder = path.dirname(relPath) === "." ? "root" : path.dirname(relPath);
      if (!folderMap.has(folder)) {
        folderMap.set(folder, /* @__PURE__ */ new Map());
      }
      folderMap.get(folder)?.set(relPath, fileInfo);
    }
    return folderMap;
  }
  function isFileChanged(prev, current) {
    return !prev || prev._mtime !== current.mtime || prev._size !== current.size;
  }
  async function checkForChanges(dir, previous) {
    const previousMap = new Map(previous.map((entry) => [entry.path, entry]));
    const currentFiles = await collectMarkdownFilesWithMetadata(dir);
    for (const [relPath, { metadata }] of currentFiles) {
      if (isFileChanged(previousMap.get(relPath), metadata)) {
        return { changed: true, updatedFiles: currentFiles };
      }
    }
    if (previous.length !== currentFiles.size) {
      return { changed: true, updatedFiles: currentFiles };
    }
    return { changed: false, updatedFiles: currentFiles };
  }
  async function checkForFolderChanges(dir) {
    const allFolders = await collectFilesByFolder(dir);
    const changedFolders = /* @__PURE__ */ new Set();
    if (!incrementalByFolder) {
      for (const folder of allFolders.keys()) {
        changedFolders.add(folder);
      }
      return { changedFolders, allFolders };
    }
    const prevGlobalManifest = await loadPreviousManifest();
    const prevFilesByFolder = /* @__PURE__ */ new Map();
    for (const meta of prevGlobalManifest) {
      const folder = meta.folder || "root";
      if (!prevFilesByFolder.has(folder)) {
        prevFilesByFolder.set(folder, /* @__PURE__ */ new Map());
      }
      prevFilesByFolder.get(folder)?.set(meta.path, meta);
    }
    for (const [folder, files] of allFolders) {
      const prevFiles = prevFilesByFolder.get(folder);
      if (!prevFiles) {
        changedFolders.add(folder);
        continue;
      }
      let folderChanged = false;
      for (const [relPath, { metadata }] of files) {
        const prevFile = prevFiles.get(relPath);
        if (isFileChanged(prevFile, metadata)) {
          folderChanged = true;
          break;
        }
      }
      if (!folderChanged && prevFiles.size !== files.size) {
        folderChanged = true;
      }
      if (folderChanged) {
        changedFolders.add(folder);
      }
    }
    return { changedFolders, allFolders };
  }
  async function processChangedFiles(files) {
    await initializeHighlighter();
    const manifest = [];
    const content = {};
    let errorCount = 0;
    const entries = [...files.entries()];
    await execConcurrently(entries, MARKDOWN_CONFIG.CONCURRENCY.FILES, async ([relPath, { path: filePath, metadata }]) => {
      try {
        const raw = await readFile(filePath, "utf8");
        const updated = await updateFrontmatterDate(filePath, raw, metadata.mtime);
        const { data: frontmatter } = parseFrontmatter(updated);
        const { content: html, error, errorContext } = await processMarkdownFile(filePath, purifyHtml, highlighter);
        if (error) {
          const errorMessage = errorContext ? `${error}
  File: ${filePath}
  ${errorContext}` : `${error}
  File: ${filePath}`;
          throw new Error(errorMessage);
        }
        const slug = relPath.replace(new RegExp(`${extension}$`), "");
        const folder = path.dirname(relPath) === "." ? void 0 : path.dirname(relPath);
        const validFrontmatter = frontmatter || {};
        manifest.push({ slug, path: relPath, folder, _mtime: metadata.mtime, _size: metadata.size, ...validFrontmatter });
        content[slug] = { frontmatter: validFrontmatter, content: html };
      } catch (e) {
        errorCount++;
        console.error(`❌ Error processing ${filePath}:`, e);
      }
    });
    return { manifest: sortManifest(manifest), content, processedCount: manifest.length, errorCount };
  }
  async function processFolderFiles(folderFiles) {
    await initializeHighlighter();
    const manifest = [];
    const content = {};
    let errorCount = 0;
    const entries = [...folderFiles.entries()];
    await execConcurrently(entries, MARKDOWN_CONFIG.CONCURRENCY.FILES, async ([relPath, { path: filePath, metadata }]) => {
      try {
        const raw = await readFile(filePath, "utf8");
        const updated = await updateFrontmatterDate(filePath, raw, metadata.mtime);
        const { data: frontmatter } = parseFrontmatter(updated);
        const { content: html, error, errorContext } = await processMarkdownFile(filePath, purifyHtml, highlighter);
        if (error) {
          const errorMessage = errorContext ? `${error}
  File: ${filePath}
  ${errorContext}` : `${error}
  File: ${filePath}`;
          throw new Error(errorMessage);
        }
        const slug = relPath.replace(new RegExp(`${extension}$`), "");
        const folder = path.dirname(relPath) === "." ? void 0 : path.dirname(relPath);
        const validFrontmatter = frontmatter || {};
        manifest.push({ slug, path: relPath, folder, _mtime: metadata.mtime, _size: metadata.size, ...validFrontmatter });
        content[slug] = { frontmatter: validFrontmatter, content: html };
      } catch (e) {
        errorCount++;
        console.error(`❌ Error processing ${filePath}:`, e);
      }
    });
    return { manifest: sortManifest(manifest), content, errorCount };
  }
  async function processChangedFolders(changedFolders, allFolders) {
    await initializeHighlighter();
    const globalManifest = [];
    let totalProcessed = 0;
    let totalErrors = 0;
    const folderEntries = Array.from(changedFolders).map((folder) => ({ folder, files: allFolders.get(folder) }));
    await execConcurrently(folderEntries, MARKDOWN_CONFIG.CONCURRENCY.FOLDERS, async ({ folder, files }) => {
      try {
        console.info(`📂 Processing folder: ${folder} (${files.size} files)`);
        const result = await processFolderFiles(files);
        await writeFolderFiles(folder, result.manifest, result.content);
        globalManifest.push(...result.manifest);
        totalProcessed += result.manifest.length;
        totalErrors += result.errorCount;
        console.info(`✅ Completed folder: ${folder} (${result.manifest.length} files)`);
      } catch (error) {
        console.error(`❌ Error processing folder ${folder}:`, error);
        totalErrors++;
      }
    });
    return { manifest: sortManifest(globalManifest), processedCount: totalProcessed, errorCount: totalErrors };
  }
  async function loadPreviousManifest() {
    try {
      const file = getAssetPath(`${prefix}-manifest.json`);
      if (!existsSync(file)) return [];
      const globalManifest = JSON.parse(await readFile(file, "utf8"));
      return globalManifest.documents || [];
    } catch {
      return [];
    }
  }
  async function writeCompressedVersions(filename, content) {
    if (!compress) {
      return;
    }
    try {
      const buffer = Buffer.from(content, "utf8");
      const compressedBuffer = await gzipAsync(buffer);
      const compressedPath = getAssetPath(`${filename}.gz`);
      await writeFile(compressedPath, compressedBuffer);
      const ratio = ((1 - compressedBuffer.length / content.length) * 100).toFixed(1);
      console.info(`  📦 ${filename}.gz: ${compressedBuffer.length} bytes compressed ${ratio}%`);
    } catch (error) {
      console.warn(`Failed to write compressed version of ${filename}:`, error);
    }
  }
  async function writeMarkdownFiles(manifest, content, chunkedFolders) {
    try {
      const dir = path.dirname(getAssetPath("dummy"));
      await mkdir(dir, { recursive: true });
      const globalManifest = {
        documents: manifest,
        _buildMode: chunkByFolder ? "chunked" : "single",
        ...chunkByFolder && chunkedFolders && { chunkedFolders }
      };
      const manifestContent = JSON.stringify(globalManifest, null, 2);
      await writeFile(getAssetPath(`${prefix}-manifest.json`), manifestContent);
      if (!chunkByFolder && Object.keys(content).length > 0) {
        const contentJson = JSON.stringify(content, null, 2);
        if (compress) {
          await writeCompressedVersions(`${prefix}-content.json`, contentJson);
        } else {
          await writeFile(getAssetPath(`${prefix}-content.json`), contentJson);
        }
      }
    } catch (e) {
      console.error("❌ Failed to write markdown JSON files:", e);
    }
  }
  async function writeFolderFiles(folder, _manifest, content) {
    try {
      const dir = path.dirname(getAssetPath("dummy"));
      await mkdir(dir, { recursive: true });
      const folderKey = folder.replace(/[/\\]/g, "-");
      const filename = `${prefix}-content-${folderKey}.json`;
      const contentJson = JSON.stringify(content, null, 2);
      if (compress) {
        await writeCompressedVersions(filename, contentJson);
      } else {
        await writeFile(getAssetPath(filename), contentJson);
      }
    } catch (e) {
      console.error(`❌ Failed to write folder files for ${folder}:`, e);
    }
  }
  return {
    name: "markdown-builder",
    async buildStart() {
      const docsDir = path.join(process.cwd(), source);
      try {
        await stat(docsDir);
      } catch {
        console.info(`📄 Source directory '${source}' does not exist, skipping markdown build`);
        return;
      }
      if (chunkByFolder) {
        const { changedFolders, allFolders } = await checkForFolderChanges(docsDir);
        if (changedFolders.size === 0) {
          console.info("📄 No folder changes detected, skipping build");
          return;
        }
        console.info(`📂 Processing ${changedFolders.size} changed folders out of ${allFolders.size} total`);
        const result = await processChangedFolders(changedFolders, allFolders);
        const folderList = Array.from(allFolders.keys());
        await writeMarkdownFiles(result.manifest, {}, folderList);
        console.info(`  📄 Processed ${result.processedCount} files with ${result.errorCount} errors`);
      } else {
        const prev = await loadPreviousManifest();
        const { changed, updatedFiles } = await checkForChanges(docsDir, prev);
        if (!changed) return;
        const result = await processChangedFiles(updatedFiles);
        await writeMarkdownFiles(result.manifest, result.content);
        console.info(`  📄 Processing ${updatedFiles.size} updated markdown files from: ${source}`);
      }
    },
    async handleHotUpdate({ file, server }) {
      if (file.includes(source) && file.endsWith(extension)) {
        const docsDir = path.join(process.cwd(), source);
        if (chunkByFolder) {
          const relativePath = path.relative(path.join(process.cwd(), source), file);
          const folder = path.dirname(relativePath) === "." ? "root" : path.dirname(relativePath);
          const allFolders = await collectFilesByFolder(docsDir);
          const changedFolders = /* @__PURE__ */ new Set([folder]);
          const result = await processChangedFolders(changedFolders, allFolders);
          const globalManifest = await loadPreviousManifest();
          const updatedManifest = globalManifest.filter((item) => item.folder !== folder);
          updatedManifest.push(...result.manifest);
          const allFoldersForHotReload = await collectFilesByFolder(docsDir);
          const folderList = Array.from(allFoldersForHotReload.keys());
          await writeMarkdownFiles(sortManifest(updatedManifest), {}, folderList);
          console.info(`🔄 Hot updated folder: ${folder}`);
        } else {
          const files = await collectMarkdownFilesWithMetadata(docsDir);
          const result = await processChangedFiles(files);
          await writeMarkdownFiles(result.manifest, result.content);
        }
        server.ws.send({ type: "full-reload" });
      }
    }
  };
}
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n(.*?)\n---\s*\n(.*)$/s);
  if (!match) {
    return { data: {}, content };
  }
  const [, frontmatterText, markdown] = match;
  const frontmatter = {};
  if (!frontmatterText) return frontmatter;
  const lines = frontmatterText.split("\n").filter((line) => line.trim());
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      const cleanValue = value.replace(/^['"]|['"]$/g, "");
      if (key === "date" && cleanValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
        frontmatter[key] = new Date(cleanValue).toISOString().split("T")[0];
      } else {
        frontmatter[key] = cleanValue;
      }
    }
  }
  return { data: frontmatter, content: markdown };
}
async function processMarkdownFile(filePath, purifyHtml = true, highlighter) {
  try {
    const source = await readFile(filePath, "utf8");
    const { content: markdown } = parseFrontmatter(source);
    const markdownString = typeof markdown === "string" ? markdown : String(markdown || "");
    const htmlContent = marked.parse(markdownString, { breaks: true, gfm: true });
    if (typeof htmlContent !== "string") {
      return { content: markdownString, error: `Unexpected marked result type: ${typeof htmlContent}` };
    }
    const sanitizedContent = purifyHtml ? DOMPurify.sanitize(htmlContent, DOMPURIFY_CONFIG) : htmlContent;
    const result = highlighter ? await highlightCodeBlocks(htmlContent, highlighter, filePath) : { content: sanitizedContent };
    if ("error" in result) {
      return { content: "", error: result.error, errorContext: result.errorContext };
    }
    return { content: result.content };
  } catch (error) {
    return {
      content: "",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
function sortManifest(manifest) {
  return manifest.sort((a, b) => {
    const folderA = a.folder || "";
    const folderB = b.folder || "";
    if (folderA !== folderB) {
      return folderA.localeCompare(folderB);
    }
    if (a.date && b.date) {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    }
    if (a.title && b.title) {
      return a.title.localeCompare(b.title);
    }
    return a.slug.localeCompare(b.slug);
  });
}
async function createShikiHighlighter(config = {}) {
  const { langs = [...HIGHLIGHTER_CONFIG.LANGS], themes = [...HIGHLIGHTER_CONFIG.THEMES] } = config;
  const highlighter = await createHighlighter({ langs, themes });
  return {
    highlight: (code, language) => {
      try {
        const html = highlighter.codeToHtml(code, { lang: language, theme: "night-owl", colorReplacements: { "#011627": "#1f2937" } });
        return html.replace(/<pre[^>]*>/, '<pre class="overflow-x-auto text-xs md:text-sm" style="background-color: #1f2937 !important;">');
      } catch (error) {
        if (error instanceof Error && error.message.includes("not found")) {
          throw new Error(`Language \`${language}\` not found in Shiki highlighter`);
        }
        throw error;
      }
    }
  };
}
async function highlightCodeBlocks(htmlContent, highlighter, filePath) {
  const codeBlockRegex = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;
  let processedContent = htmlContent;
  const matches = [...htmlContent.matchAll(codeBlockRegex)];
  for (const match of matches) {
    const [fullMatch, language, codeContent] = match;
    if (!codeContent) continue;
    const decodedContent = codeContent.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    try {
      const highlightedContent = await highlighter.highlight(decodedContent, language || "text");
      processedContent = processedContent.replace(fullMatch, highlightedContent);
    } catch (error) {
      const codeSnippet = decodedContent.substring(0, 100).replace(/\n/g, "\\n");
      const errorContext = `Language: \`${language || "text"}\`
  Code snippet: "${codeSnippet}${decodedContent.length > 100 ? "..." : ""}"`;
      console.error("\n❌ Markdown Processing Error:");
      console.error(`  File: ${filePath || "unknown"}`);
      console.error(`  ${errorContext}`);
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`
  💡 Solution: Add '${language}' to HIGHLIGHTER_CONFIG.LANGS in markdown-config.ts
`);
      return {
        error: `Failed to highlight code block with language "${language}"`,
        errorContext
      };
    }
  }
  return { content: processedContent };
}
async function execConcurrently(items, limit, handler) {
  const executing = [];
  for (const item of items) {
    const p = handler(item);
    executing.push(p);
    if (executing.length >= limit) {
      await Promise.race(executing).catch(() => {
      });
      for (let i = executing.length - 1; i >= 0; i--) {
        try {
          await executing[i];
          executing.splice(i, 1);
        } catch {
          executing.splice(i, 1);
        }
      }
    }
  }
  await Promise.allSettled(executing);
}
export {
  getAssetPath,
  markdownBuilder
};
//# sourceMappingURL=index.js.map
