import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getUser, verifyPassword } from '../auth.js';

export function authRouter(db: Database.Database): Router {
  const r = express.Router();
  r.get('/login', (req: Request, res: Response) => res.render('login', { error: null }));
  r.post('/login', (req: Request, res: Response) => {
    const { username, password } = req.body as { username: string; password: string };
    const user = getUser(db, username);
    if (user && verifyPassword(password, user.password_hash)) {
      req.session.userId = user.id;
      return res.redirect('/');
    }
    res.render('login', { error: 'Invalid username or password' });
  });
  r.post('/logout', (req: Request, res: Response) => req.session.destroy(() => res.redirect('/login')));
  return r;
}
