import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const demoDir = path.dirname(fileURLToPath(import.meta.url));

/** Fixed port — avoids stale Vite on 5173/5174 without API proxies. */
const DEMO_PORT = 3999;

function stripMountPrefix(url: string, mount: string): string {
  const q = url.indexOf('?');
  const pathname = q >= 0 ? url.slice(0, q) : url;
  const search = q >= 0 ? url.slice(q) : '';
  if (!pathname.startsWith(mount)) return url;
  const rest = pathname.slice(mount.length) || '/';
  return rest + search;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function forwardHeaders(req: IncomingMessage): Headers {
  const out = new Headers();
  const skip = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'origin', 'referer']);
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || skip.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) value.forEach((v) => out.append(key, v));
    else out.set(key, value);
  }
  return out;
}

/**
 * Same-origin API proxy (runs before Vite's HTML fallback).
 * Without this, POST /api/openai/... returns 404 from the demo static server.
 */
function apiProxyPlugin(): Plugin {
  const routes: Array<{ mount: string; target: string }> = [
    { mount: '/api/anthropic', target: 'https://api.anthropic.com' },
    { mount: '/api/openai', target: 'https://api.openai.com' },
  ];

  return {
    name: 'voicelayer-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url ?? '';
        const route = routes.find((r) => raw.startsWith(r.mount));
        if (!route || !req.method) return next();

        const forwardUrl = route.target + stripMountPrefix(raw, route.mount);

        try {
          const body =
            req.method === 'GET' || req.method === 'HEAD'
              ? undefined
              : await readBody(req);

          const fwdHeaders = forwardHeaders(req);

          // Log the user message and available actions sent to Claude
          if (body?.length && forwardUrl.includes('anthropic')) {
            try {
              const parsed = JSON.parse(body.toString()) as { messages?: Array<{role: string; content: string}> };
              const userMsg = parsed.messages?.find(m => m.role === 'user')?.content ?? '';
              // User said: "..." appears at the end after Visible data block
              const saidMatch = /User said:\s*"([^"]+)"/.exec(userMsg);
              // eslint-disable-next-line no-console
              console.log('\n[proxy] USER SAID:', saidMatch?.[1] ?? '(not found)');
              // Available actions block: "Available actions:\n[...]\n\nVisible data"
              const actionsBlockMatch = /Available actions:\n(\[[\s\S]*?\])\n\nVisible data/.exec(userMsg);
              if (actionsBlockMatch) {
                const actions = JSON.parse(actionsBlockMatch[1]) as Array<{label: string; selector: string; elementType: string; context: string}>;
                // eslint-disable-next-line no-console
                console.log('[proxy] ACTIONS COUNT:', actions.length);
                // eslint-disable-next-line no-console
                console.log('[proxy] FIRST 10 ACTIONS:', actions.slice(0, 10).map(a => `[${a.context}/${a.elementType}] "${a.label}" → ${a.selector}`).join('\n  '));
              } else {
                // eslint-disable-next-line no-console
                console.log('[proxy] FULL USER MSG (first 800 chars):\n', userMsg.slice(0, 800));
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.log('[proxy] failed to parse body:', e);
            }
          }

          const upstream = await fetch(forwardUrl, {
            method: req.method,
            headers: fwdHeaders,
            body: body?.length ? body : undefined,
          });

          // Log Claude's raw response
          const respClone = upstream.clone();
          respClone.json().then((r: {content?: Array<{text?: string}>}) => {
            const text = r.content?.[0]?.text ?? '';
            // eslint-disable-next-line no-console
            console.log('[proxy] CLAUDE REPLIED:', text.slice(0, 300));
          }).catch(() => {});
          // eslint-disable-next-line no-console
          console.log('[proxy] ←', upstream.status, forwardUrl);
          await pipeResponse(upstream, res);
        } catch (err) {
          if (!res.headersSent) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(
              `VoiceLayer proxy error: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      });

      server.httpServer?.once('listening', () => {
        // eslint-disable-next-line no-console
        console.log(
          `\n  ➜  VoiceLayer demo: http://localhost:${DEMO_PORT}/?openai=YOUR_KEY&tts=browser\n` +
            `  ➜  API proxy:       http://localhost:${DEMO_PORT}/api/openai\n`,
        );
      });
    },
  };
}

async function pipeResponse(upstream: Response, res: ServerResponse): Promise<void> {
  res.statusCode = upstream.status;
  // Node.js fetch auto-decompresses gzip/br, so strip encoding/length headers
  // that would mismatch the already-decoded body the browser receives.
  const stripResponse = new Set(['transfer-encoding', 'content-encoding', 'content-length']);
  upstream.headers.forEach((value, key) => {
    if (stripResponse.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.end(buf);
}

export default defineConfig({
  root: demoDir,
  plugins: [apiProxyPlugin()],
  server: {
    port: DEMO_PORT,
    strictPort: true,
    open: '/?tts=browser',
    // Forward analytics server routes so the demo can use server-side proxy
    // mode without CORS issues.  The custom apiProxyPlugin still handles
    // direct /api/anthropic and /api/openai paths for key-in-URL mode.
    proxy: {
      '/proxy':     { target: 'http://localhost:3001', changeOrigin: true },
      '/api/voice': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/events':{ target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: path.resolve(demoDir, '../dist-demo'),
    emptyOutDir: true,
  },
});
