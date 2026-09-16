import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { getDbClient } from '@mohpa/db';

describe('News Routes (/news.xml & /api/v1/news)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const db = await getDbClient();
    app = await buildServer({ db, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /news.xml returns valid XML with launch announcement for mohPA revival', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/news.xml'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
    expect(res.headers['connection']).toBe('close');

    const body = res.body;
    expect(body).toContain('<?xml version="1.0"?>');
    expect(body).toContain('<mohpanews>');
    expect(body).toContain('</mohpanews>');
    expect(body).toContain('<news year="2026" month="9" day="16">');
    expect(body).toContain('Launch day of the mohPA revival!');
    expect(body).toContain('https://mohpa.net');

    // Requirement check: MUST NOT mention centralspy!
    expect(body.toLowerCase()).not.toContain('centralspy');
  });

  it('GET /news alias returns identical XML', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/news'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
    expect(res.body).toContain('<mohpanews>');
    expect(res.body.toLowerCase()).not.toContain('centralspy');
  });

  it('GET /api/v1/news returns JSON news list for portal/web', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/news'
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(Array.isArray(json.news)).toBe(true);
    expect(json.news.length).toBeGreaterThan(0);
    expect(json.news[0].year).toBe(2026);
    expect(json.news[0].month).toBe(9);
    expect(json.news[0].day).toBe(16);
    expect(json.news[0].content).toContain('Launch day of the mohPA revival!');
    expect(json.news[0].link).toBe('https://mohpa.net');
    expect(res.body.toLowerCase()).not.toContain('centralspy');
  });
});
