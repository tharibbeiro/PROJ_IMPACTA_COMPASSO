import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  root: 'frontend',
  plugins: [react(), VitePWA({
    registerType:'prompt', injectRegister:null,
    includeAssets:['icon.svg','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png'],
    manifest:{ id:'/',name:'Compasso Acadêmico — Demonstração',short_name:'Compasso Acad.',description:'Demonstração de finanças em três camadas com API e banco SQL. Use somente dados fictícios.',lang:'pt-BR',start_url:'/',scope:'/',display:'standalone',background_color:'#f7f8f4',theme_color:'#087f63',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]},
    workbox:{globPatterns:['**/*.{js,css,html,ico,png,svg,woff,woff2}'],maximumFileSizeToCacheInBytes:4*1024*1024,navigateFallback:'index.html',navigateFallbackDenylist:[/^\/api(?:\/|$)/,/^\/entrega(?:\/|$)/],cleanupOutdatedCaches:true,skipWaiting:false,clientsClaim:false,runtimeCaching:[]},devOptions:{enabled:false},
  })],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
});
