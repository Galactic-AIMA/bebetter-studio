import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Tipografías de la UI, autoalojadas (DESIGN.md §3). Las del render van aparte,
// por `/api/fonts` en index.css.
import '@fontsource/ibm-plex-sans/300.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/anton/400.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
