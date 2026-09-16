/**
 * mohPA News & Updates Routes
 * Serves /news.xml for the in-game MOHPA client (sv_newsOfTheDayURL)
 * and /api/v1/news for web/portal consumers.
 */

import { FastifyPluginAsync } from 'fastify';

export interface NewsItem {
  id: string;
  year: number;
  month: number;
  day: number;
  title: string;
  content: string;
  link: string;
  date: string;
}

export const DEFAULT_NEWS_ITEMS: NewsItem[] = [
  {
    id: 'mohpa-revival-launch',
    year: 2026,
    month: 9,
    day: 16,
    title: 'mohPA Revival Launch Day',
    content:
      'Launch day of the mohPA revival! Dedicated servers, stats, and online multiplayer are officially live.\nVisit https://mohpa.net for downloads, guides, and server browser.',
    link: 'https://mohpa.net',
    date: '2026-09-16'
  }
];

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildNewsXml(items: NewsItem[] = DEFAULT_NEWS_ITEMS): string {
  const newsTags = items
    .map(
      (item) =>
        `    <news year="${item.year}" month="${item.month}" day="${item.day}">${escapeXml(
          item.content
        )}</news>`
    )
    .join('\n');

  return `<?xml version="1.0"?>\n<mohpanews>\n${newsTags}\n</mohpanews>\n`;
}

export const newsRoutes: FastifyPluginAsync = async (fastify) => {
  // In-game client XML route for sv_newsOfTheDayURL
  fastify.get('/news.xml', async (_request, reply) => {
    const xml = buildNewsXml(DEFAULT_NEWS_ITEMS);
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Connection', 'close')
      .send(xml);
  });

  // Alias /news to return the same XML
  fastify.get('/news', async (_request, reply) => {
    const xml = buildNewsXml(DEFAULT_NEWS_ITEMS);
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Connection', 'close')
      .send(xml);
  });

  // REST API route for frontend / portal / launchers
  fastify.get('/api/v1/news', async (_request, reply) => {
    return reply.send({
      news: DEFAULT_NEWS_ITEMS
    });
  });
};
