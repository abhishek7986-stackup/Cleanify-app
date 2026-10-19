#!/usr/bin/env node
/**
 * Plain-http door into the https dev server, for this Mac only.
 *
 *   npm run dev:https      phones use https://<mac-ip>:3000 (camera needs https)
 *   npm run dev:mac        this Mac uses http://localhost:3001
 *
 * Next.js allows one dev server per project, so the Mac cannot also run plain
 * `next dev`. And some browsers, including the one built into the Claude app,
 * refuse the self-signed certificate outright. localhost counts as secure
 * without https, so forwarding to the running server is all the Mac needs.
 *
 * Listens on 127.0.0.1 only: nothing else on the network can reach it.
 */

import http from "node:http";
import https from "node:https";
import tls from "node:tls";

const PORT = Number(process.env.PROXY_PORT ?? 3001);
const TARGET_PORT = Number(process.env.TARGET_PORT ?? 3000);
const TARGET = "localhost";
// Connect by IPv4: Node resolves "localhost" to ::1 first, where Next is not
// listening. The Host header still says localhost so the app sees no change.
const TARGET_IP = "127.0.0.1";

const server = http.createServer((req, res) => {
  const upstream = https.request(
    {
      host: TARGET_IP,
      servername: TARGET,
      port: TARGET_PORT,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `${TARGET}:${TARGET_PORT}` },
      rejectUnauthorized: false, // our own self-signed dev certificate
    },
    (up) => {
      // Redirects from the app point at the https origin; keep the browser here.
      const headers = { ...up.headers };
      if (headers.location) {
        headers.location = headers.location.replace(
          `https://${TARGET}:${TARGET_PORT}`,
          `http://localhost:${PORT}`,
        );
      }
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`The https dev server is not running on port ${TARGET_PORT}.\n${err.message}\n`);
  });
  req.pipe(upstream);
});

// Hot reload runs over a WebSocket; pass the upgrade straight through.
server.on("upgrade", (req, socket, head) => {
  const up = tls.connect({ host: TARGET_IP, servername: TARGET, port: TARGET_PORT, rejectUnauthorized: false }, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries({ ...req.headers, host: `${TARGET}:${TARGET_PORT}` })) {
      lines.push(`${k}: ${v}`);
    }
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mac link: http://localhost:${PORT}  ->  https://${TARGET}:${TARGET_PORT}`);
});
