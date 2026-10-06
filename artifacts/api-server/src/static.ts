import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "public, max-age=3600");
      }
    },
  }));

  app.get("/privacy", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "privacy", "index.html"));
  });

  const spaRoutes = [
    /^\/sign-in(?:\/.*)?$/,
    /^\/sign-up(?:\/.*)?$/,
    /^\/welcome$/,
    /^\/customer$/,
    /^\/washer(?:\/profile)?$/,
    /^\/orders\/[^/]+$/,
    /^\/settings$/,
    /^\/incidents(?:\/[^/]+)?$/,
    /^\/admin\/incidents(?:\/[^/]+)?$/,
    /^\/admin\/revenue$/,
  ];

  app.get("/{*path}", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    if (spaRoutes.some((route) => route.test(req.path))) {
      return res.sendFile(path.resolve(distPath, "index.html"));
    }

    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    return res.status(404).sendFile(path.resolve(distPath, "404.html"));
  });
}
