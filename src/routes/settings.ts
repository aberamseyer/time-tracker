import express, { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getSettings, updateSettings } from '../settings.js';
import { listTags, createTag, updateTag, archiveTag } from '../catalog.js';
import { suggestColor, DEFAULT_TAG_COLOR } from '../colors.js';
import type { Hub } from '../types.js';

function ensureUserId(req: Request): number {
  return (req.session && req.session.userId) ? req.session.userId : 0;
}

function tagsPartial(db: Database.Database, req: Request, res: Response) {
  res.render('partials/settings-tags', { tags: listTags(db, ensureUserId(req)), newTagColor: suggestColor(db, 'tag') });
}

export function settingsRouter(db: Database.Database, hub: Hub): Router {
  const r = express.Router();

  r.get('/settings', (req: Request, res: Response) =>
    res.render('settings', {
      title: 'Settings', nav: 'settings', settings: getSettings(db, ensureUserId(req)), tags: listTags(db, ensureUserId(req)),
      newTagColor: suggestColor(db, 'tag'), error: null,
    }));

  r.post('/settings', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const body = req.body as Record<string, unknown>;
    try {
      updateSettings(db, userId, {
        roundingMinutes: body.roundingMinutes,
        sessionGrouping: body.sessionGrouping,
        weekStart: body.weekStart,
      });
      hub.broadcast('changed');
      res.redirect('/settings');
    } catch {
      res.render('settings', {
        title: 'Settings', nav: 'settings', settings: getSettings(db, userId), tags: listTags(db, userId),
        newTagColor: suggestColor(db, 'tag'), error: 'Invalid setting value',
      });
    }
  });

  r.post('/settings/tags', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const body = req.body as Record<string, unknown>;
    const name = ((body.name as string) || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    createTag(db, { name, color: (body.color as string) || DEFAULT_TAG_COLOR }, userId);
    hub.broadcast('changed');
    tagsPartial(db, req, res);
  });
  r.post('/settings/tags/:id', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    const body = req.body as Record<string, unknown>;
    const name = ((body.name as string) || '').trim();
    if (!name) return res.status(400).render('partials/error', { message: 'Tag name is required' });
    updateTag(db, Number(req.params.id), { name, color: (body.color as string) || DEFAULT_TAG_COLOR }, userId);
    hub.broadcast('changed');
    tagsPartial(db, req, res);
  });
  r.post('/settings/tags/:id/archive', (req: Request, res: Response) => {
    const userId = ensureUserId(req);
    archiveTag(db, Number(req.params.id), userId);
    hub.broadcast('changed');
    tagsPartial(db, req, res);
  });

  return r;
}