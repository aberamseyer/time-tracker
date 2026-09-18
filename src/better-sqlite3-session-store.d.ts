declare module 'better-sqlite3-session-store' {
  import type { Store } from 'express-session';
  interface Options { client: unknown; expired?: { clear?: boolean; intervalMs?: number }; }
  function factory(session: unknown): new (opts: Options) => Store;
  export default factory;
}
