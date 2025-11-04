/** biome-ignore-all lint/suspicious/noExplicitAny: acceptable */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { createHighlighter } from 'shiki';
import type { Plugin } from 'vite';
import type { FileMetadata, FolderContentChunk, Frontmatter, GlobalManifest, MarkdownBuilderOptions, MarkdownMeta, ProcessingResult, ShikiConfig, SyntaxHighlighter } from '../@types/markdown.types';
import { DOMPURIFY_CONFIG, HIGHLIGHTER_CONFIG, MARKDOWN_CONFIG } from '../markdown-config';
import { getAssetPath } from './plugin-utils';

const gzipAsync = promisify(gzip);

export function markdownBuilder(options: MarkdownBuilderOptions): Plugin {
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
    compress = MARKDOWN_CONFIG.COMPRESS,
  } = options;

  let highlighter: SyntaxHighlighter | null = null;
  let isInitialized = false;

  async function updateFrontmatterDate(filePath: string, content: string, fileMtime: number): Promise<string> {
    if (!updateDate) return content;

    const { data: frontmatter, content: markdown } = parseFrontmatter(content);
    const fileDate = new Date(fileMtime).toISOString().split('T')[0];

    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return content;
    if (frontmatter.date === fileDate) return content;

    const updatedFrontmatter = { ...frontmatter, date: fileDate };
    const frontmatterStr = Object.entries(updatedFrontmatter)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? `"${value}"` : value}`)
      .join('\n');

    const updatedContent = `---\n${frontmatterStr}\n---\n${markdown}`;

    try {
      await writeFile(filePath, updatedContent);

      // Restore original timestamp to preserve manual edit time
      const originalDate = new Date(fileMtime);
      await utimes(filePath, originalDate, originalDate);

      console.info(`📅 Updated frontmatter date in ${filePath} to match file`);
      return updatedContent;
    } catch (error) {
      console.warn(`⚠️ Failed to update date in ${filePath}:`, error);
      return content;
    }
  }

  // Initialize highlighter and marked configuration
  async function initializeHighlighter(): Promise<void> {
    if (isInitialized) return;

    if (syntaxHighlighter === null) {
      highlighter = null;
    } else if (syntaxHighlighter) {
      highlighter = syntaxHighlighter;
    } else {
      try {
        highlighter = await createShikiHighlighter(shikiConfig);
      } catch (error) {
        console.warn('⚠️ Failed to initialize Shiki highlighter:', error);
        highlighter = null;
      }
    }

    isInitialized = true;
  }

  async function collectMarkdownFilesWithMetadata(dir: string): Promise<Map<string, { path: string; metadata: FileMetadata }>> {
    const result = new Map();

    async function walk(current: string) {
      const entries = await readdir(current, { withFileTypes: true });
      await Promise.all(
        entries.map(async entry => {
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

  async function collectFilesByFolder(dir: string): Promise<Map<string, Map<string, { path: string; metadata: FileMetadata }>>> {
    const folderMap = new Map();
    const files = await collectMarkdownFilesWithMetadata(dir);

    for (const [relPath, fileInfo] of files) {
      const folder = path.dirname(relPath) === '.' ? 'root' : path.dirname(relPath);
      if (!folderMap.has(folder)) {
        folderMap.set(folder, new Map());
      }
      folderMap.get(folder)?.set(relPath, fileInfo);
    }

    return folderMap;
  }

  function isFileChanged(prev: MarkdownMeta | undefined, current: FileMetadata): boolean {
    return !prev || prev._mtime !== current.mtime || prev._size !== current.size;
  }

  async function checkForChanges(dir: string, previous: MarkdownMeta[]) {
    const previousMap = new Map(previous.map(entry => [entry.path, entry]));
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

  async function checkForFolderChanges(dir: string): Promise<{ changedFolders: Set<string>; allFolders: Map<string, Map<string, { path: string; metadata: FileMetadata }>> }> {
    const allFolders = await collectFilesByFolder(dir);
    const changedFolders = new Set<string>();

    if (!incrementalByFolder) {
      // If not incremental, mark all folders as changed
      for (const folder of allFolders.keys()) {
        changedFolders.add(folder);
      }
      return { changedFolders, allFolders };
    }

    // Load previous global manifest and check for folder changes
    const prevGlobalManifest = await loadPreviousManifest();
    const prevFilesByFolder = new Map<string, Map<string, MarkdownMeta>>();

    // Group previous files by folder
    for (const meta of prevGlobalManifest) {
      const folder = meta.folder || 'root';
      if (!prevFilesByFolder.has(folder)) {
        prevFilesByFolder.set(folder, new Map());
      }
      prevFilesByFolder.get(folder)?.set(meta.path, meta);
    }

    // Check each current folder against previous state
    for (const [folder, files] of allFolders) {
      const prevFiles = prevFilesByFolder.get(folder);

      if (!prevFiles) {
        // New folder
        changedFolders.add(folder);
        continue;
      }

      // Check if any files in this folder have changed
      let folderChanged = false;
      for (const [relPath, { metadata }] of files) {
        const prevFile = prevFiles.get(relPath);
        if (isFileChanged(prevFile, metadata)) {
          folderChanged = true;
          break;
        }
      }

      // Check if file count changed
      if (!folderChanged && prevFiles.size !== files.size) {
        folderChanged = true;
      }

      if (folderChanged) {
        changedFolders.add(folder);
      }
    }

    return { changedFolders, allFolders };
  }

  async function processChangedFiles(files: Map<string, { path: string; metadata: FileMetadata }>): Promise<ProcessingResult> {
    await initializeHighlighter();

    const manifest: MarkdownMeta[] = [];
    const content: Record<string, any> = {};
    let errorCount = 0;

    const entries = [...files.entries()];

    await execConcurrently(entries, MARKDOWN_CONFIG.CONCURRENCY.FILES, async ([relPath, { path: filePath, metadata }]) => {
      try {
        const raw = await readFile(filePath, 'utf8');
        const updated = await updateFrontmatterDate(filePath, raw, metadata.mtime);
        const { data: frontmatter } = parseFrontmatter(updated);
        const { content: html, error, errorContext } = await processMarkdownFile(filePath, purifyHtml, highlighter);

        if (error) {
          const errorMessage = errorContext ? `${error}\n  File: ${filePath}\n  ${errorContext}` : `${error}\n  File: ${filePath}`;
          throw new Error(errorMessage);
        }

        const slug = relPath.replace(new RegExp(`${extension}$`), '');
        const folder = path.dirname(relPath) === '.' ? undefined : path.dirname(relPath);

        const validFrontmatter = (frontmatter as Frontmatter) || {};
        manifest.push({ slug, path: relPath, folder, _mtime: metadata.mtime, _size: metadata.size, ...validFrontmatter });
        content[slug] = { frontmatter: validFrontmatter, content: html };
      } catch (e) {
        errorCount++;
        console.error(`❌ Error processing ${filePath}:`, e);
      }
    });

    return { manifest: sortManifest(manifest), content, processedCount: manifest.length, errorCount };
  }

  async function processFolderFiles(folderFiles: Map<string, { path: string; metadata: FileMetadata }>): Promise<{ manifest: MarkdownMeta[]; content: FolderContentChunk; errorCount: number }> {
    await initializeHighlighter();

    const manifest: MarkdownMeta[] = [];
    const content: FolderContentChunk = {};
    let errorCount = 0;

    const entries = [...folderFiles.entries()];

    await execConcurrently(entries, MARKDOWN_CONFIG.CONCURRENCY.FILES, async ([relPath, { path: filePath, metadata }]) => {
      try {
        const raw = await readFile(filePath, 'utf8');
        const updated = await updateFrontmatterDate(filePath, raw, metadata.mtime);
        const { data: frontmatter } = parseFrontmatter(updated);
        const { content: html, error, errorContext } = await processMarkdownFile(filePath, purifyHtml, highlighter);

        if (error) {
          const errorMessage = errorContext ? `${error}\n  File: ${filePath}\n  ${errorContext}` : `${error}\n  File: ${filePath}`;
          throw new Error(errorMessage);
        }

        const slug = relPath.replace(new RegExp(`${extension}$`), '');
        const folder = path.dirname(relPath) === '.' ? undefined : path.dirname(relPath);

        const validFrontmatter = (frontmatter as Frontmatter) || {};
        manifest.push({ slug, path: relPath, folder, _mtime: metadata.mtime, _size: metadata.size, ...validFrontmatter });
        content[slug] = { frontmatter: validFrontmatter, content: html };
      } catch (e) {
        errorCount++;
        console.error(`❌ Error processing ${filePath}:`, e);
      }
    });

    return { manifest: sortManifest(manifest), content, errorCount };
  }

  async function processChangedFolders(changedFolders: Set<string>, allFolders: Map<string, Map<string, { path: string; metadata: FileMetadata }>>) {
    await initializeHighlighter();

    const globalManifest: MarkdownMeta[] = [];
    let totalProcessed = 0;
    let totalErrors = 0;

    // Process folders in parallel with limited concurrency
    // biome-ignore lint/style/noNonNullAssertion: satisfactory
    const folderEntries = Array.from(changedFolders).map(folder => ({ folder, files: allFolders.get(folder)! }));

    await execConcurrently(folderEntries, MARKDOWN_CONFIG.CONCURRENCY.FOLDERS, async ({ folder, files }) => {
      try {
        console.info(`📂 Processing folder: ${folder} (${files.size} files)`);
        const result = await processFolderFiles(files);

        // Write folder-specific files
        await writeFolderFiles(folder, result.manifest, result.content);

        // Add to global manifest
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

  async function loadPreviousManifest(): Promise<MarkdownMeta[]> {
    try {
      const file = getAssetPath(`${prefix}-manifest.json`);
      if (!existsSync(file)) return [];

      const globalManifest = JSON.parse(await readFile(file, 'utf8')) as GlobalManifest;
      return globalManifest.documents || [];
    } catch {
      return [];
    }
  }

  // Helper to write compressed versions of JSON files
  async function writeCompressedVersions(filename: string, content: string) {
    if (!compress) {
      return;
    }

    try {
      const buffer = Buffer.from(content, 'utf8');
      const compressedBuffer = await gzipAsync(buffer);
      const compressedPath = getAssetPath(`${filename}.gz`);
      await writeFile(compressedPath, compressedBuffer);

      const ratio = ((1 - compressedBuffer.length / content.length) * 100).toFixed(1);
      console.info(`  📦 ${filename}.gz: ${compressedBuffer.length} bytes compressed ${ratio}%`);
    } catch (error) {
      console.warn(`Failed to write compressed version of ${filename}:`, error);
    }
  }

  // Function to write JSON files with optional compression
  async function writeMarkdownFiles(manifest: MarkdownMeta[], content: Record<string, any>, chunkedFolders?: string[]) {
    try {
      const dir = path.dirname(getAssetPath('dummy'));
      await mkdir(dir, { recursive: true });

      // Create global manifest with chunking metadata
      const globalManifest: GlobalManifest = {
        documents: manifest,
        _buildMode: chunkByFolder ? 'chunked' : 'single',
        ...(chunkByFolder && chunkedFolders && { chunkedFolders }),
      };

      // Write manifest (always uncompressed - small file, frequently accessed)
      const manifestContent = JSON.stringify(globalManifest, null, 2);
      await writeFile(getAssetPath(`${prefix}-manifest.json`), manifestContent);

      // Write content if not chunked
      if (!chunkByFolder && Object.keys(content).length > 0) {
        const contentJson = JSON.stringify(content, null, 2);

        if (compress) {
          // Only write compressed version for content files
          await writeCompressedVersions(`${prefix}-content.json`, contentJson);
        } else {
          // Write uncompressed version if compression is disabled
          await writeFile(getAssetPath(`${prefix}-content.json`), contentJson);
        }
      }
    } catch (e) {
      console.error('❌ Failed to write markdown JSON files:', e);
    }
  }

  async function writeFolderFiles(folder: string, _manifest: MarkdownMeta[], content: FolderContentChunk) {
    try {
      const dir = path.dirname(getAssetPath('dummy'));
      await mkdir(dir, { recursive: true });

      const folderKey = folder.replace(/[/\\]/g, '-');
      const filename = `${prefix}-content-${folderKey}.json`;

      // Write folder content chunk only - manifest contains all metadata
      const contentJson = JSON.stringify(content, null, 2);

      if (compress) {
        // Only write compressed version for content files
        await writeCompressedVersions(filename, contentJson);
      } else {
        // Write uncompressed version if compression is disabled
        await writeFile(getAssetPath(filename), contentJson);
      }
    } catch (e) {
      console.error(`❌ Failed to write folder files for ${folder}:`, e);
    }
  }

  return {
    name: 'markdown-builder',
    async buildStart() {
      const docsDir = path.join(process.cwd(), source);

      // Check if source directory exists, skip if not
      try {
        await stat(docsDir);
      } catch {
        console.info(`📄 Source directory '${source}' does not exist, skipping markdown build`);
        return;
      }

      if (chunkByFolder) {
        const { changedFolders, allFolders } = await checkForFolderChanges(docsDir);

        if (changedFolders.size === 0) {
          console.info('📄 No folder changes detected, skipping build');
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
          // Determine which folder changed and only rebuild that folder
          const relativePath = path.relative(path.join(process.cwd(), source), file);
          const folder = path.dirname(relativePath) === '.' ? 'root' : path.dirname(relativePath);

          const allFolders = await collectFilesByFolder(docsDir);
          const changedFolders = new Set([folder]);

          const result = await processChangedFolders(changedFolders, allFolders);

          // Update global manifest
          const globalManifest = await loadPreviousManifest();
          const updatedManifest = globalManifest.filter(item => item.folder !== folder);
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

        server.ws.send({ type: 'full-reload' });
      }
    },
  };
}

// Simple frontmatter parser (no dependencies)
function parseFrontmatter(content: string) {
  const match = content.match(/^---\s*\n(.*?)\n---\s*\n(.*)$/s);
  if (!match) {
    return { data: {}, content };
  }

  const [, frontmatterText, markdown] = match;
  const frontmatter: Frontmatter = {};

  if (!frontmatterText) return frontmatter;

  // Simple YAML parser for basic key-value pairs
  const lines = frontmatterText.split('\n').filter(line => line.trim());
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      // Remove quotes if present
      const cleanValue = value.replace(/^['"]|['"]$/g, '');

      // Try to parse as date
      if (key === 'date' && cleanValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
        frontmatter[key] = new Date(cleanValue).toISOString().split('T')[0];
      } else {
        frontmatter[key] = cleanValue;
      }
    }
  }

  return { data: frontmatter, content: markdown };
}

async function processMarkdownFile(filePath: string, purifyHtml = true, highlighter?: SyntaxHighlighter | null): Promise<{ content: string; error?: string; errorContext?: string }> {
  try {
    const source = await readFile(filePath, 'utf8');
    const { content: markdown } = parseFrontmatter(source);
    const markdownString = typeof markdown === 'string' ? markdown : String(markdown || '');
    const htmlContent = marked.parse(markdownString, { breaks: true, gfm: true });

    if (typeof htmlContent !== 'string') {
      return { content: markdownString, error: `Unexpected marked result type: ${typeof htmlContent}` };
    }

    const sanitizedContent = purifyHtml ? DOMPurify.sanitize(htmlContent, DOMPURIFY_CONFIG) : htmlContent;
    const result = highlighter ? await highlightCodeBlocks(htmlContent, highlighter, filePath) : { content: sanitizedContent };

    if ('error' in result) {
      return { content: '', error: result.error, errorContext: result.errorContext };
    }

    return { content: result.content };
  } catch (error) {
    return {
      content: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sortManifest(manifest: MarkdownMeta[]): MarkdownMeta[] {
  return manifest.sort((a, b) => {
    // Sort by folder first
    const folderA = a.folder || '';
    const folderB = b.folder || '';

    if (folderA !== folderB) {
      return folderA.localeCompare(folderB);
    }

    // Within same folder, sort by date (newest first)
    if (a.date && b.date) {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    }

    // Then by title
    if (a.title && b.title) {
      return a.title.localeCompare(b.title);
    }

    // Finally by slug to ensure deterministic ordering
    return a.slug.localeCompare(b.slug);
  });
}

// Create default Shiki highlighter
async function createShikiHighlighter(config: ShikiConfig = {}): Promise<SyntaxHighlighter> {
  const { langs = [...HIGHLIGHTER_CONFIG.LANGS], themes = [...HIGHLIGHTER_CONFIG.THEMES] } = config;
  const highlighter = await createHighlighter({ langs, themes });

  return {
    highlight: (code: string, language: string) => {
      try {
        const html = highlighter.codeToHtml(code, { lang: language, theme: 'night-owl', colorReplacements: { '#011627': '#1f2937' } });
        // Add mobile-responsive classes to the generated pre element
        return html.replace(/<pre[^>]*>/, '<pre class="overflow-x-auto text-xs md:text-sm" style="background-color: #1f2937 !important;">');
      } catch (error) {
        // Provide helpful error message for missing languages
        if (error instanceof Error && error.message.includes('not found')) {
          throw new Error(`Language \`${language}\` not found in Shiki highlighter`);
        }
        throw error;
      }
    },
  };
}

async function highlightCodeBlocks(htmlContent: string, highlighter: SyntaxHighlighter, filePath?: string): Promise<{ content: string } | { error: string; errorContext?: string }> {
  // Regular expression to find code blocks: <pre><code class="language-xxx">content</code></pre>
  const codeBlockRegex = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

  let processedContent = htmlContent;
  const matches = [...htmlContent.matchAll(codeBlockRegex)];

  for (const match of matches) {
    const [fullMatch, language, codeContent] = match;

    if (!codeContent) continue;

    // Decode HTML entities in the code content
    const decodedContent = codeContent
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    try {
      const highlightedContent = await highlighter.highlight(decodedContent, language || 'text');
      processedContent = processedContent.replace(fullMatch, highlightedContent);
    } catch (error) {
      // Extract a snippet of the code for context (first 100 chars)
      const codeSnippet = decodedContent.substring(0, 100).replace(/\n/g, '\\n');
      const errorContext = `Language: \`${language || 'text'}\`\n  Code snippet: "${codeSnippet}${decodedContent.length > 100 ? '...' : ''}"`;

      console.error('\n❌ Markdown Processing Error:');
      console.error(`  File: ${filePath || 'unknown'}`);
      console.error(`  ${errorContext}`);
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`\n  💡 Solution: Add '${language}' to HIGHLIGHTER_CONFIG.LANGS in markdown-config.ts\n`);

      // Return error with context instead of continuing
      return {
        error: `Failed to highlight code block with language "${language}"`,
        errorContext,
      };
    }
  }

  return { content: processedContent };
}

async function execConcurrently<T>(items: T[], limit: number, handler: (item: T) => Promise<void>): Promise<void> {
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const p = handler(item);
    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing).catch(() => {});
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
