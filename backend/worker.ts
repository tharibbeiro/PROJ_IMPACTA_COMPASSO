import { createApp } from './app';
import type { AppBindings } from './app';

interface Asset { type: string; base64: string }
declare const __STATIC_ASSETS__: Record<string, Asset>;
const app = createApp();
const cache = new Map<string, Uint8Array>();
export default {
  async fetch(request: Request, env: AppBindings): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return app.fetch(request, env);
    const normalized = path.endsWith('/') ? `${path}index.html` : path;
    const key = __STATIC_ASSETS__[normalized] ? normalized : path.startsWith('/assets/') || path.includes('.') ? normalized : '/index.html';
    const asset = __STATIC_ASSETS__[key];
    if (!asset) return new Response('Arquivo não encontrado.', { status: 404 });
    if (!cache.has(key)) cache.set(key, Uint8Array.from(atob(asset.base64), (c) => c.charCodeAt(0)));
    return new Response(request.method === 'HEAD' ? null : cache.get(key), { headers: {
      'Content-Type': asset.type, 'Cache-Control': key.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    } });
  },
};
