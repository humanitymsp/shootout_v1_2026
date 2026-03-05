import React from 'react';
import ReactDOM from 'react-dom/client';
// Import Amplify configuration FIRST before anything else
import './lib/amplify';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
