import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest `globals` 關閉時 RTL 不會自動 cleanup。
afterEach(() => cleanup());
