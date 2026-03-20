export class Logger {
  constructor(private prefix: string) {}
  info(msg: string) { console.log(`[${this.prefix}] INFO: ${msg}`); }
  warn(msg: string) { console.warn(`[${this.prefix}] WARN: ${msg}`); }
  error(msg: string) { console.error(`[${this.prefix}] ERROR: ${msg}`); }
}
