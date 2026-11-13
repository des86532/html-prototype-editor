import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { disableZodJit } from '@hpe/shared';
import { installTrustedTypesPolicy } from '@/lib/sanitize';
import { queryClient } from '@/lib/queryClient';
import { router } from '@/router';
import './styles.css';

// Trusted Types 的 default policy 必須在任何 render 之前安裝。
installTrustedTypesPolicy();
disableZodJit();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
