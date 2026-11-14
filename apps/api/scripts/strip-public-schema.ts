/**
 * drizzle-kit 會把外鍵參照寫成 `"public"."table"`，導致 migration 無法套用到其他 schema
 * （測試時每個測試檔使用獨立 schema）。產生 migration 後執行此腳本移除 `"public".` 前綴。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');
for (const name of readdirSync(dir).filter((n) => n.endsWith('.sql'))) {
  const file = path.join(dir, name);
  const before = readFileSync(file, 'utf8');
  const after = before.replaceAll('"public".', '');
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`stripped "public". from ${name}`);
  }
}
