import { createServer } from "../server";

export const config = { maxDuration: 60 };

const app = createServer();
const ready = app.ready();

export default async function handler(request: any, response: any) {
  await ready;
  app.server.emit("request", request, response);
}
