import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import './rettoStock.css';
import App from './App';
import './styles/rettoRoulette.skin.css';
import './styles/rettoRoulette.shell.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
