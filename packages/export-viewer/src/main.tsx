import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readPayload, showFatal } from './boot';
import { ExportViewer } from './ExportViewer';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  try {
    const payload = readPayload(document);
    createRoot(root).render(
      <StrictMode>
        <ExportViewer payload={payload} />
      </StrictMode>,
    );
  } catch (e) {
    showFatal(root, e);
  }
}
