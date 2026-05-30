import { openDb } from "./db.ts";
import { createServer } from "./server.ts";

const db = openDb();
const app = createServer(db);
const port = Number(process.env.PORT ?? 4000);

app.listen(port, () => {
  console.log(`Pinline running on http://localhost:${port}`);
});
