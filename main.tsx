import React from 'react';
import { createRoot } from 'react-dom/client';
import { LifeManagerPage } from './app';
import { browserDemo } from './ui/runtime';
import { DemoNotice } from './ui/DemoNotice';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{browserDemo
  ? <div className="lm-demo-shell"><DemoNotice /><LifeManagerPage /></div>
  : <LifeManagerPage />}</React.StrictMode>);
