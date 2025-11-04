import path from 'node:path';
import { ASSET_PREFIX } from '../markdown-config';

/**
 * Get the full asset path for files during build time
 * @param filename - The filename to get the path for
 * @param prefix - Optional alternate prefix to use instead of default
 * @returns Full path where the file should be written during build
 */
export function getAssetPath(filename: string, prefix?: string): string {
  // Use provided prefix or fall back to default build prefix
  const buildPrefix = prefix || ASSET_PREFIX.build;
  // Normalize the build prefix to handle leading slashes
  const normalizedPrefix = buildPrefix.startsWith('/') ? buildPrefix.slice(1) : buildPrefix;
  return path.join(process.cwd(), 'public', normalizedPrefix, filename);
}
