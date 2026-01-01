
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import YunovaLanding from './YunovaLanding';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

const hostname = (globalThis.location?.hostname || '').toLowerCase();
const isYunovaSite = hostname === 'yunova.org' || hostname === 'www.yunova.org';

root.render(
  <React.StrictMode>
    {isYunovaSite ? <YunovaLanding /> : <App />}
  </React.StrictMode>
);
