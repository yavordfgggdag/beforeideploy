import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build works on a web host and inside the Tauri shell.
export default defineConfig({ plugins: [react()], base: './', build: { outDir: 'dist', sourcemap: true } });
