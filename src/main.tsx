import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { SuiProviders } from './components/SuiProviders';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SuiProviders>
      <App />
    </SuiProviders>
  </React.StrictMode>,
);
