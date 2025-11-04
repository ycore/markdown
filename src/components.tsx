/** biome-ignore-all lint/a11y/noSvgWithoutTitle: acceptable */
import { SpriteIcon } from '@ycore/componentry/images';
import { LoadingBar } from '@ycore/componentry/impetus';
import { ThemeSwitch } from '@ycore/componentry/impetus/theme';
import { type IconName, Link } from '@ycore/componentry/vibrant';
import clsx from 'clsx';
import { memo, useCallback, useEffect, useState } from 'react';
import { useFetcher, useLocation, useNavigate } from 'react-router';
import type { DocContent, EnhancedMarkdownMeta, MarkdownPageData, MarkdownPageProps, MarkdownProps } from './@types/markdown.types';
import { ASSET_ROUTES } from './markdown-config';

// ============================================================================
// CORE MARKDOWN RENDERER COMPONENT
// ============================================================================

/**
 * Simple markdown content renderer component
 * Renders pre-sanitized HTML content from markdown processing
 */
export function MarkdownRenderer({ children, className = '' }: MarkdownProps): React.JSX.Element {
  if (!children || typeof children !== 'string') {
    return <div className={className} />;
  }

  // biome-ignore lint/security/noDangerouslySetInnerHtml: Content is pre-sanitized at build time
  return <div className={className} dangerouslySetInnerHTML={{ __html: children }} />;
}

// ============================================================================
// MAIN DOCUMENTATION PAGE COMPONENT
// ============================================================================

// Type guards
const isDocContent = (data: unknown): data is DocContent => {
  return typeof data === 'object' && data !== null && 'content' in data && 'frontmatter' in data && 'slug' in data;
};

const isMarkdownPageData = (data: unknown): data is MarkdownPageData => {
  return typeof data === 'object' && data !== null && 'manifest' in data;
};

/**
 * Main documentation page component with sidebar navigation and document viewer
 */
export function MarkdownPage({ loaderData, spriteUrl }: MarkdownPageProps): React.JSX.Element {
  // Handle both data structures: array of docs or structured page data
  const pageData = isMarkdownPageData(loaderData) ? loaderData : { manifest: loaderData, selectedDoc: undefined, document: undefined };
  const { manifest: docs, selectedDoc: preloadedDoc, document: preloadedDocument, loading: serverLoading } = pageData;

  const location = useLocation();
  const navigate = useNavigate();
  const [selectedDoc, setSelectedDoc] = useState<string | null>(preloadedDoc || null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fetcher = useFetcher();

  const handleDocSelect = useCallback(
    (slug: string) => {
      if (selectedDoc === slug) return;
      navigate(ASSET_ROUTES.docs(slug));
    },
    [selectedDoc, navigate]
  );

  // Initialize selected doc from URL path or preloaded data
  useEffect(() => {
    if (preloadedDoc && preloadedDoc !== selectedDoc) {
      setSelectedDoc(preloadedDoc);
      setError(null);
    } else {
      // Extract slug from URL path: /forge/docs/some/nested/path -> some/nested/path
      const pathParts = location.pathname.split('/');
      const docsIndex = pathParts.indexOf('docs');
      if (docsIndex !== -1 && docsIndex < pathParts.length - 1) {
        const slug = pathParts.slice(docsIndex + 1).join('/');
        if (slug && docs.find((doc: EnhancedMarkdownMeta) => doc.slug === slug) && selectedDoc !== slug) {
          setSelectedDoc(slug);
          // Only fetch if we don't have preloaded document data
          if (!preloadedDocument || preloadedDoc !== slug) {
            fetcher.load(ASSET_ROUTES.docsApi(slug));
          }
        }
      } else if (selectedDoc && !preloadedDoc) {
        // No slug in path, clear selection
        setSelectedDoc(null);
        setError(null);
      }
    }
  }, [docs, fetcher.load, selectedDoc, location.pathname, preloadedDoc, preloadedDocument]);

  // Handle fetch errors
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data && !isDocContent(fetcher.data)) {
      setError('Failed to load document');
    }
  }, [fetcher.state, fetcher.data]);

  // Determine current document: preloaded document, fetched document, or none
  const currentDoc =
    preloadedDocument && preloadedDoc === selectedDoc ? { content: preloadedDocument.content, frontmatter: preloadedDocument.frontmatter, slug: selectedDoc } : isDocContent(fetcher.data) ? fetcher.data : undefined;

  return (
    <div className="min-h-screen bg-white transition-colors dark:bg-gray-900">
      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`fixed inset-y-0 top-0 left-0 z-20 flex w-80 flex-col border-gray-200 border-r bg-white transition-transform duration-300 dark:border-gray-800 dark:bg-gray-900 ${sidebarCollapsed ? '-translate-x-full' : 'translate-x-0'}`}
        >
          {/* Scrollable navigation area */}
          <div className="flex-1 overflow-y-auto p-6 pb-20">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 text-lg dark:text-white">Documentation</h2>
              <div>
                <button type="button" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="rounded-md p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                  <SpriteIcon<IconName> spriteUrl={spriteUrl} iconId="ChevronLeft" className="h-5 w-5" />
                </button>
              </div>
            </div>
            <nav className="space-y-1" aria-label="Documentation navigation">
              {docs.length === 0 ? <DocListEmpty /> : <DocList docs={docs} selectedDoc={selectedDoc} onDocSelect={handleDocSelect} spriteUrl={spriteUrl} />}
            </nav>
          </div>

          {/* Sticky footer */}
          <div className="border-gray-200/50 border-t p-4 backdrop-blur-sm dark:border-gray-800/50">
            <div className="flex items-center justify-end gap-x-3">
              <Link href="/">
                <SpriteIcon<IconName> spriteUrl={spriteUrl} iconId="House" className="size-5 text-accent-foreground transition-colors hover:text-accent-foreground/80" viewBox="0 0 24 24" />
              </Link>
              <ThemeSwitch spriteUrl={spriteUrl} />
            </div>
          </div>
        </aside>

        {/* Sidebar toggle button - visible when sidebar is collapsed */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          className={`fixed top-4 left-4 z-30 rounded-md border border-gray-200 bg-white p-2 text-gray-500 shadow-sm transition-opacity duration-300 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:text-gray-200 ${sidebarCollapsed ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <SpriteIcon<IconName> spriteUrl={spriteUrl} iconId="EllipsisVertical" className="h-5 w-5" />
        </button>

        {/* Main content */}
        <main className={`flex-1 transition-all duration-300 ${sidebarCollapsed ? 'pl-0' : 'pl-64'} min-w-0`}>
          <div className="mx-auto min-w-0 max-w-4xl px-4 md:px-8">
            {!selectedDoc ? (
              <div className="flex h-96 items-center justify-center">
                <div className="text-center">
                  <div className="mb-4 text-gray-400 dark:text-gray-500">
                    <SpriteIcon<IconName> spriteUrl={spriteUrl} iconId="CircleAlert" className="h-8 w-8" />
                  </div>
                  <h3 className="mb-2 font-medium text-gray-900 text-lg dark:text-white">Select a document</h3>
                  <p className="text-gray-500 dark:text-gray-400">Choose a document from the sidebar to view its content.</p>
                </div>
              </div>
            ) : fetcher.state === 'loading' || serverLoading || (selectedDoc && !currentDoc && !error) ? (
              <LoadingBar />
            ) : error ? (
              <DocumentNotFound spriteUrl={spriteUrl} />
            ) : currentDoc ? (
              <article className="markdown-content min-w-0 py-8 md:py-12">
                <DocumentHeader frontmatter={currentDoc.frontmatter} />
                <MarkdownRenderer className="min-w-0 max-w-none">{currentDoc.content}</MarkdownRenderer>
              </article>
            ) : (
              <DocumentNotFound spriteUrl={spriteUrl} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// SUPPORTING UI COMPONENTS
// ============================================================================

const DocListEmpty = () => {
  return <p className="text-gray-500 text-sm dark:text-gray-400">No documentation found.</p>;
};

const DocumentNotFound = memo(({ spriteUrl }: { spriteUrl: string }) => (
  <div className="flex h-96 items-center justify-center">
    <div className="text-center">
      <div className="mb-4 text-red-400 dark:text-red-500">
        <SpriteIcon<IconName> spriteUrl={spriteUrl} iconId="CircleAlert" className="mx-auto h-8 w-8" />
      </div>
      <h3 className="mb-2 font-medium text-gray-900 text-lg dark:text-white">Document not found</h3>
      <p className="text-gray-500 dark:text-gray-400">The selected document could not be loaded.</p>
    </div>
  </div>
));

// biome-ignore lint/suspicious/noExplicitAny: acceptable
const DocumentHeader = memo(({ frontmatter }: { frontmatter: Record<string, any> }) => (
  <header className="mb-8">
    {frontmatter.title && <h1 className="mb-4 font-bold font-serif text-3xl text-gray-900 dark:text-white">{frontmatter.title}</h1>}
    {frontmatter.description && <p className="mb-4 font-serif text-gray-600 text-lg dark:text-gray-300">{frontmatter.description}</p>}
    {(frontmatter.formattedDate || frontmatter.version) && (
      <div className="flex items-center justify-between text-gray-500 text-sm dark:text-gray-400">
        {frontmatter.formattedDate && (
          <time className="font-sans" dateTime={frontmatter.date}>
            {frontmatter.formattedDate}
          </time>
        )}
        {frontmatter.version && <span className="px-2 py-1 font-mono text-gray-300 text-xs italic dark:text-gray-600">{frontmatter.version}</span>}
      </div>
    )}
  </header>
));

const DocList = memo(({ docs, selectedDoc, onDocSelect, spriteUrl }: { docs: EnhancedMarkdownMeta[]; selectedDoc: string | null; onDocSelect: (slug: string) => void; spriteUrl: string }) => {
  // Group documents by folder and track which is first in each folder
  const groupedDocs = useCallback(() => {
    const groups: { [folder: string]: EnhancedMarkdownMeta[] } = {};

    for (const doc of docs) {
      const folder = doc.folder || '';
      if (!groups[folder]) {
        groups[folder] = [];
      }
      groups[folder].push(doc);
    }

    return groups;
  }, [docs]);

  const groups = groupedDocs();

  return (
    <div className="space-y-1">
      {Object.entries(groups).map(([folder, folderDocs]) => {
        const isRootLevel = folder === '';
        const folderId = `folder-${folder.replace(/[^a-zA-Z0-9]/g, '-')}`;

        return (
          <div key={folder || 'root'}>
            {!isRootLevel && (
              <div className="relative">
                <input type="checkbox" id={folderId} className="peer hidden" defaultChecked={true} />
                <label htmlFor={folderId} className="flex w-full cursor-pointer items-center px-3 py-2 text-left text-gray-600 text-sm transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50">
                  <SpriteIcon<IconName> spriteUrl={spriteUrl} iconId="ChevronRight" className="mr-2 h-3 w-3 transition-transform duration-200 peer-checked:rotate-90" />
                  <span className="font-medium capitalize">{folder}</span>
                </label>

                <div className="ml-6 max-h-0 space-y-0.5 overflow-hidden transition-all duration-300 peer-checked:max-h-96">
                  {folderDocs.map(doc => (
                    <button
                      key={doc.slug}
                      type="button"
                      onClick={() => onDocSelect(doc.slug)}
                      className={clsx(
                        'w-full px-3 py-2 text-left text-sm transition-colors focus:outline-none',
                        selectedDoc === doc.slug
                          ? 'border-blue-500 border-r-2 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-100'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'
                      )}
                    >
                      <div className="flex items-center">
                        <div className="flex-1">
                          <div className="font-medium">{doc.title || doc.slug}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isRootLevel && (
              <div className="space-y-0.5">
                {folderDocs.map(doc => (
                  <button
                    key={doc.slug}
                    type="button"
                    onClick={() => onDocSelect(doc.slug)}
                    className={clsx(
                      'w-full px-3 py-2 text-left text-sm transition-colors focus:outline-none',
                      selectedDoc === doc.slug
                        ? 'border-blue-500 border-r-2 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-100'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/50'
                    )}
                  >
                    <div className="font-medium">{doc.title || doc.slug}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
