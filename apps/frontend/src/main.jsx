import React from 'react';
import ReactDOM from 'react-dom/client';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from './shared/contexts/ThemeContext';
import { createOfflineQueryClient, persistOptions, setupOfflineSync } from './shared/offline/queryClient';
import { registerRootClient } from './shared/offline/mutations';
import { registerMutationDefaults } from './shared/offline/mutations.registry';
import App from './App';
import './index.css';

const queryClient = createOfflineQueryClient();
setupOfflineSync(queryClient);
registerRootClient(queryClient);
registerMutationDefaults(queryClient);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      onSuccess={() => {
        queryClient.resumePausedMutations().catch(() => {});
      }}
    >
      <ThemeProvider>
        <App />
      </ThemeProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#112236',
            color:      '#E2EBF5',
            border:     '1px solid rgba(59,158,232,0.2)',
            borderRadius: '12px',
          },
          success: { iconTheme: { primary: '#22c55e', secondary: '#112236' } },
          error:   { iconTheme: { primary: '#f43f5e', secondary: '#112236' } },
        }}
      />
    </PersistQueryClientProvider>
  </React.StrictMode>
);