import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { BlobNotFoundError, SHA256_RE, type ResolvedVersion, type Resolver } from './resolver.js';
import { contentTypeFor } from './mime.js';
import { isContentKey } from './resolveVersion.js';

export interface FixtureSite {
  /** 磁碟上的資料夾，整個資料夾就是 bundle */
  dir: string;
  entryPage?: string;
  cdnAllowlist?: string[];
}

/** 資料夾內的選用設定檔（不會出現在 bundle 裡）。 */
export const FIXTURE_CONFIG = '.hpe-fixture.json';

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    // 只收一般檔案與目錄；symlink 一律忽略（和匯入時的規則一致）。
    if (entry.isDirectory()) walk(root, abs, out);
    else if (entry.isFile()) out.push(relative(root, abs).split(sep).join('/').normalize('NFC'));
  }
}

/**
 * 測試／開發用 resolver：`contentKey → 資料夾`。每次 resolve 都重新掃描（fixture 很小，改檔立即生效）。
 * `sha256` 只是「路徑 + mtime + size」的雜湊（不讀檔案內容），夠當 blob 的唯一 id。
 */
export class FixtureResolver implements Resolver {
  private readonly sites = new Map<string, FixtureSite>();
  private readonly blobs = new Map<string, string>();

  constructor(sites: Record<string, FixtureSite> = {}) {
    for (const [key, site] of Object.entries(sites)) this.set(key, site);
  }

  /** 資料夾名稱 = contentKey（必須符合格式）；可選 `.hpe-fixture.json` 提供 entryPage／cdnAllowlist。 */
  static fromDirectory(root: string): FixtureResolver {
    const r = new FixtureResolver();
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isContentKey(entry.name)) continue;
      const dir = join(root, entry.name);
      const cfgPath = join(dir, FIXTURE_CONFIG);
      const cfg = existsSync(cfgPath)
        ? (JSON.parse(readFileSync(cfgPath, 'utf8')) as Partial<FixtureSite>)
        : {};
      r.set(entry.name, { ...cfg, dir });
    }
    return r;
  }

  set(contentKey: string, site: FixtureSite): void {
    this.sites.set(contentKey, { ...site, dir: resolvePath(site.dir) });
  }

  /** 模擬 contentKey 輪替／撤銷。 */
  revoke(contentKey: string): void {
    this.sites.delete(contentKey);
  }

  async resolve(contentKey: string): Promise<ResolvedVersion | null> {
    const site = this.sites.get(contentKey);
    if (!site) return null;
    let cfg: Partial<FixtureSite> = {};
    const cfgPath = join(site.dir, FIXTURE_CONFIG);
    if (existsSync(cfgPath))
      cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Partial<FixtureSite>;
    const files: string[] = [];
    walk(site.dir, site.dir, files);
    files.sort();
    const assets = files.map((path) => {
      const abs = join(site.dir, ...path.split('/'));
      const st = statSync(abs);
      const sha256 = createHash('sha256').update(`${abs}\0${st.mtimeMs}\0${st.size}`).digest('hex');
      this.blobs.set(sha256, abs);
      return {
        path,
        sha256,
        size: st.size,
        mime: contentTypeFor(path) ?? 'application/octet-stream',
      };
    });
    return {
      versionId: `fixture-${contentKey}`,
      entryPage: site.entryPage ?? cfg.entryPage ?? 'index.html',
      cdnAllowlist: site.cdnAllowlist ?? cfg.cdnAllowlist ?? [],
      assets,
    };
  }

  async openAsset(sha256: string): Promise<Readable> {
    const abs = SHA256_RE.test(sha256) ? this.blobs.get(sha256) : undefined;
    if (!abs) throw new BlobNotFoundError(sha256);
    return createReadStream(abs);
  }
}
