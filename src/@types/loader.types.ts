import type { MarkdownLoaderArgs } from './markdown.types';

export interface LoaderArgs extends MarkdownLoaderArgs {
  params: { '*': string };
}
