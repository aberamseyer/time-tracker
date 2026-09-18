import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getSettings, updateSettings } from '../settings.js';
import { listTags, createTag, updateTag, archiveTag } from '../catalog.js';
import { suggestColor, DEFAULT_TAG_COLOR } from '../colors.js';
import type { Hub } from '../types.js';

export function settingsRouter(db: Database.Database, hub: Hub): Router {
  const r = express.Router();

  r.get('/settings', (req: Request, res: Response) =>
    res.render('settings', {
      title: 'Settings', nav: 'settings', settings: getSettings(db), tags: listTags(db),
      newTagColor: suggestColor(db, 'tag'), error: null,
    }));

  r.post('/settings', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    try {
      updateSettings(db, {
        roundingMinutes: body.roundingMinutes,
        sessionGrouping: body.sessionGrouping,
        weekStart: body.weekStart,
      });
      hub.broadcast('changed');
      res.redirect('/settings');
    } catch {
      res.render('settings', {
        title: 'Settings', nav: 'settings', settings: getSettings(db), tags: listTags(db),
        newTagColor: suggestColor(db, 'tag'), error: 'Invalid setting value',
      });
    }
  });

  const tagsPartial = (res: Response) =>
    res.render('partials/settings-tags', { tags: listTags(db), newTagColor: suggestColor(db, 'tag') });

  r.post('/settings/tags', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const name = ((body.name as string) || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    createTag(db, { name, color: (body.color as string) || DEFAULT_TAG_COLOR });
    hub.broadcast('changed');
    tagsPartial(res);
  });
  r.post('/settings/tags/:id', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const name = ((body.name as string) || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    updateTag(db, Number(req.params.id), { name, color: (body.color as string) || DEFAULT_TAG_COLOR });
    hub.broadcast('changed');
    tagsPartial(res);
  });
  r.post('/settings/tags/:id/archive', (req: Request, res: Response) => {
    archiveTag(db, Number(req.params.id));
    hub.broadcast('changed');
    tagsPartial(res);
  });

  return r;
}
