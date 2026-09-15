import express from 'express';
import { getUser, verifyPassword } from '../auth.js';

export function authRouter(db) {
  const r = express.Router();
  r.get('/login', (req, res) => res.render('login', { error: null }));
  r.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = getUser(db, username);
    if (user && verifyPassword(password, user.password_hash)) {
      req.session.userId = user.id;
      return res.redirect('/');
    }
    res.render('login', { error: 'Invalid username or password' });
  });
  r.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
  return r;
}
