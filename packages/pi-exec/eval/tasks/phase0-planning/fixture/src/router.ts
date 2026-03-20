type Handler = (req: any) => any;

const routes: Record<string, Handler> = {};

export function createRouter() {
  return {
    get: (path: string, handler: Handler) => {
      routes[`GET ${path}`] = handler;
    },
    post: (path: string, handler: Handler) => {
      routes[`POST ${path}`] = handler;
    },
    handle: (method: string, path: string, req: any) => {
      const key = `${method} ${path}`;
      const handler = routes[key];
      if (!handler) throw new Error(`No route: ${key}`);
      return handler(req);
    },
  };
}
