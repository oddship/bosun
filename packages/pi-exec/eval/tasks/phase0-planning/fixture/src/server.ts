import { createRouter } from "./router.js";

export function createServer(port: number) {
  const router = createRouter();
  return {
    listen: () => console.log(`Listening on port ${port}`),
    router,
  };
}
