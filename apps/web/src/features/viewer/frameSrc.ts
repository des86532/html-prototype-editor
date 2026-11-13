import { contentUrl } from '@hpe/shared';

export function contentBaseDomain(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.VITE_CONTENT_BASE_DOMAIN ?? env.CONTENT_BASE_DOMAIN ?? 'content.localhost:5174';
}

/** `{scheme}://{contentKey}.{CONTENT_BASE_DOMAIN}/{page}`；每個路徑片段各自 encode。 */
export function frameSrc(
  contentKey: string,
  pagePath: string,
  baseDomain: string = contentBaseDomain(),
): string {
  const scheme = baseDomain.includes('localhost') ? 'http' : 'https';
  const encoded = pagePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return contentUrl(baseDomain, contentKey, encoded, scheme);
}
