import { getMarkdownDocument, getMarkdownManifest } from '../markdown-data';

export async function markdownLoader({ request, ASSETS }: { request: Request; ASSETS: Fetcher }) {
  try {
    const manifest = await getMarkdownManifest(ASSETS, request);
    return manifest;
  } catch (_error) {
    return [];
  }
}

export async function markdownSlugLoader({ validatedSlug, request, ASSETS }: { validatedSlug: string; request: Request; ASSETS: Fetcher }) {
  const url = new URL(request.url);
  const isApiCall = url.searchParams.has('api') || request.headers.get('Accept')?.includes('application/json');

  try {
    const manifest = await getMarkdownManifest(ASSETS, request).catch(() => []);
    const docExists = manifest.some(doc => doc.slug === validatedSlug);

    if (!docExists) {
      throw new Response('Document not found', { status: 404 });
    }

    const doc = await getMarkdownDocument(validatedSlug, ASSETS, request);

    if (!doc) {
      if (isApiCall) {
        throw new Response('Document not found', { status: 404 });
      }
      // For UI requests, return manifest with loading state
      return { manifest, selectedDoc: validatedSlug, document: null, loading: true };
    }

    const enhancedFrontmatter = {
      ...doc.frontmatter,
      formattedDate: doc.frontmatter.date ? new Date(doc.frontmatter.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : undefined,
    };

    // If it's an API call, return the document data
    if (isApiCall) {
      return Response.json({ content: doc.content, frontmatter: enhancedFrontmatter, slug: validatedSlug });
    }

    const enhancedDoc = { ...doc, frontmatter: enhancedFrontmatter };

    return { manifest, selectedDoc: validatedSlug, document: enhancedDoc };
  } catch (error) {
    // If it's a 404 error, re-throw it
    if (error instanceof Response && error.status === 404) {
      throw error;
    }

    // For other errors, return loading state for non-API calls
    if (!isApiCall) {
      const manifest = await getMarkdownManifest(ASSETS, request).catch(() => []);
      return { manifest, selectedDoc: validatedSlug, document: null, loading: true };
    }

    // For API calls, throw the error
    throw error;
  }
}
