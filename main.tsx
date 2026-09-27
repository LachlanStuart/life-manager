import React from 'react';
import { createRoot } from 'react-dom/client';
import { LifeManagerPage } from './app';

createRoot(document.getElementById('root')!).render(<React.StrictMode><LifeManagerPage /></React.StrictMode>);
