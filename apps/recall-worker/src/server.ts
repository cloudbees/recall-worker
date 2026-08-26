// Recall Discovery worker — internal HTTP API.
//
// Not exposed through ingress. Core API is the only caller; it owns
// authentication, rate limiting and the public routes, and proxies here.
//
// Uses node:http directly rather than a framework: four routes do not justify a
// dependency, and it keeps the container free of anything that needs installing.
//
// MUST run at replicas: 1. The active-discoveries registry is an in-memory Map
// of AbortControllers, so status and cancel are only correct if every request
// lands on the process that started the discovery.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { activeDiscoveries } from '../lib/services/active-discoveries.ts';
import { runDiscovery, DiscoveryInputError, type DiscoveryInput } from './pipeline.ts';

const PORT = Number(process.env.PORT ?? 8080);

// Bodies are small JSON payloads from Core API, but cap anyway so a malformed
// or hostile caller cannot exhaust memory.
const MAX_BODY_BYTES = 1_000_000;

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new DiscoveryInputError('Request body too large');
    }
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DiscoveryInputError('Request body is not valid JSON');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  try {
    // --- health, for Kubernetes probes ---
    if (method === 'GET' && (path === '/healthz' || path === '/')) {
      return send(res, 200, { ok: true, activeDiscoveries: activeDiscoveries.count() });
    }

    // --- start a discovery (blocking; see pipeline.ts) ---
    if (method === 'POST' && path === '/discoveries') {
      const body = (await readJsonBody(req)) as DiscoveryInput;

      // node:http has no AbortSignal on the request (that is the Fetch API), so
      // bridge the socket close event into one. The pipeline only logs this — it
      // deliberately runs to completion even if Core API hangs up — but the
      // signal is threaded through to preserve the monolith's behaviour exactly.
      const disconnect = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) disconnect.abort();
      });

      const result = await runDiscovery(body, disconnect.signal);
      return send(res, 200, result);
    }

    // --- poll in-flight discoveries ---
    if (method === 'GET' && path === '/discoveries/active') {
      return send(res, 200, {
        discoveries: activeDiscoveries.list(),
        count: activeDiscoveries.count(),
      });
    }

    // --- cancel a discovery ---
    const cancelMatch = path.match(/^\/discoveries\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      const discoveryId = decodeURIComponent(cancelMatch[1]);
      const cancelled = activeDiscoveries.cancel(discoveryId);
      return send(res, cancelled ? 200 : 404, {
        cancelled,
        discoveryId,
        ...(cancelled ? {} : { error: 'Discovery not found or already finished' }),
      });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    if (error instanceof DiscoveryInputError) {
      return send(res, 400, { error: error.message });
    }

    // Client disconnected mid-run. The pipeline deliberately continues, so this
    // is informational; nothing useful can be written to a closed socket.
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.log('[worker] Request aborted by caller');
      if (!res.headersSent) send(res, 499, { error: 'Request cancelled', aborted: true });
      return;
    }

    console.error('[worker] Unhandled error:', error);
    if (!res.headersSent) {
      send(res, 500, {
        error: 'Failed to discover requirements',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
});

// Discovery runs are long (FDA/CPSC fetches plus several model calls). Node's
// default 5-minute header timeout and 0 request timeout are not the constraint,
// but the socket must not be reaped mid-pipeline.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 65_000;

server.listen(PORT, () => {
  console.log(`[worker] Recall Discovery worker listening on :${PORT}`);
});

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, closing server`);
  server.close(() => process.exit(0));
  // Do not wait forever for in-flight discoveries to finish.
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
