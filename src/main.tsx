import * as React from 'react';
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { startMobileTables } from './lib/mobileTables'
import { installApiQueue } from './lib/apiQueue'
import { startPwa } from './lib/pwa'

installApiQueue();
startMobileTables();
startPwa();

createRoot(document.getElementById("root")!).render(<App />);