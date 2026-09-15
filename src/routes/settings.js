import express from 'express';
import { getSettings, updateSettings } from '../settings.js';

export function settingsRouter(db, hub) {
  const r = express.Router();
  r.get('/settings', (req, res) =>
    res.render('settings', { title: 'Settings', nav: 'settings', settings: getSettings(db), error: null }));
  r.post('/settings', (req, res) => {
    try {
      updateSettings(db, { roundingMinutes: req.body.roundingMinutes });
      hub.broadcast('changed');
      res.redirect('/settings');
    } catch {
      res.render('settings', { title: 'Settings', nav: 'settings', settings: getSettings(db), error: 'Invalid rounding value' });
    }
  });
  return r;
}
