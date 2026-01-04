#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(process.argv[2] || "web");
const port = Number(process.argv[3] || 8788);

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  const filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
});

server.listen(port, () => {
  console.log(`Widget dev server running on http://localhost:${port}`);
});