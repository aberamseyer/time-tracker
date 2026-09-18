import 'express-session';
import type Database from 'better-sqlite3';
import type { Hub } from './types.js';

declare module 'express-session' {
  interface SessionData { userId?: number; }
}

declare global {
  namespace Express {
    interface Locals { db: Database.Database; hub: Hub; }
  }
}

export {};
