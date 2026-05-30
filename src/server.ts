import type { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import { createPin, deletePin, getPin, listPins, updatePin } from "./pin.ts";
import { prioritize } from "./priority.ts";
import { parseQuickAdd, toCreateInput } from "./quickadd.ts";

export function createServer(db: DatabaseSync): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/pins", (req, res) => {
    if (req.query.all === "true") {
      res.json(listPins(db)); // raw, unsorted, snoozed included
      return;
    }
    res.json(prioritize(listPins(db)));
  });

  app.post("/api/pins", (req, res) => {
    try {
      res.status(201).json(createPin(db, req.body));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Quick-add: parse one line into a Pin. Dimensions are parsed and echoed
  // but not yet persisted (no dimension tables until slice 5).
  app.post("/api/pins/quick", (req, res) => {
    const text = req.body?.text;
    if (typeof text !== "string") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    try {
      const parsed = parseQuickAdd(text);
      const pin = createPin(db, toCreateInput(parsed));
      res.status(201).json({ pin, parsed });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/api/pins/:id", (req, res) => {
    const pin = getPin(db, req.params.id);
    if (!pin) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(pin);
  });

  app.patch("/api/pins/:id", (req, res) => {
    try {
      const pin = updatePin(db, req.params.id, req.body);
      if (!pin) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json(pin);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.delete("/api/pins/:id", (req, res) => {
    if (!deletePin(db, req.params.id)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(204).end();
  });

  // Serve the built frontend (when present) and fall back to index.html for the SPA.
  const webDist = path.join(process.cwd(), "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  return app;
}
