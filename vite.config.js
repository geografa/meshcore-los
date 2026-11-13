import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	worker: { format: 'es' },
	server: {
		// the nodes API may not allow other origins (CORS): proxy it in dev, see README for production
		proxy: { '/mc-api': { target: 'https://map.meshcore.io', changeOrigin: true, rewrite: p => p.replace(/^\/mc-api/, '/api') } },
	},
});
