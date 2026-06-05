import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
  // Signal a successful mount so the HTML bootstrap's error handler won't
  // overwrite the app with an error panel.
  container.dataset.mounted = '1';
}
