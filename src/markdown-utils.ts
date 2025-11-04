import * as v from 'valibot';
import { ASSET_PREFIX } from './markdown-config';

/**
 * Schema for validating document slugs
 * Allows: letters, numbers, hyphens, underscores, and forward slashes
 * Prevents: directory traversal attempts, leading/trailing slashes
 */
const documentSlugSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, 'Slug cannot be empty'),
  v.regex(/^[a-zA-Z0-9-_/]+$/, 'Slug can only contain letters, numbers, hyphens, underscores, and forward slashes'),
  v.check(slug => !slug.includes('..'), 'Directory traversal not allowed'),
  v.check(slug => !slug.startsWith('/'), 'Slug cannot start with forward slash'),
  v.check(slug => !slug.endsWith('/'), 'Slug cannot end with forward slash')
);

/**
 * Validates and sanitizes a document slug
 * @param slug - The slug to validate
 * @returns Validated slug
 * @throws Response with 400 status if validation fails
 */
export function validateDocumentSlug(slug: unknown): string {
  try {
    return v.parse(documentSlugSchema, slug);
  } catch (error) {
    if (error instanceof v.ValiError) {
      const message = error.issues[0]?.message || 'Invalid document url';
      throw new Response(message, { status: 400 });
    }
    throw new Response('Invalid document slug', { status: 400 });
  }
}

/**
 * Format the asset URL for fetching at runtime
 * @param filename - The filename to get the URL for
 * @param request - Optional request object for absolute URL generation
 * @param prefix - Optional alternate prefix to use instead of default
 * @returns Base URL where the file can be fetched at runtime (fetchContent will handle .gz fallback)
 */
export function formatAssetUrl(filename: string, request?: Request, prefix?: string): string {
  // Use provided prefix or fall back to default fetch prefix
  const fetchPrefix = prefix || ASSET_PREFIX.fetch;
  const normalizedPrefix = fetchPrefix.endsWith('/') ? fetchPrefix.slice(0, -1) : fetchPrefix;
  const url = `${normalizedPrefix}/${filename}`;
  return request ? new URL(url, request.url).href : url;
}
