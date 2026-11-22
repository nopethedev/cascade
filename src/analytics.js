import { Op } from 'sequelize';
import { AnalyticsEvent, FileRecord } from './db.js';

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function clientIp(req) {
  const fwd = req.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64);
}

// Fire-and-forget: analytics must never break or slow down a request.
export function recordEvent(req, type, { fileId = null, bytes = null } = {}) {
  const p = String(req.path || '');
  const channel = req.apiKey ? 'api' : p.startsWith('/c/') || p.startsWith('/raw/') ? 'public' : 'web';
  AnalyticsEvent.create({
    type,
    fileId,
    userId: req.user?.id || null,
    channel,
    ip: clientIp(req),
    userAgent: (req.get('user-agent') || '').slice(0, 255) || null,
    referer: (req.get('referer') || '').slice(0, 255) || null,
    bytes: bytes == null ? null : Number(bytes) || 0,
  }).catch(() => {});
}

export async function analyticsSummary({ days = 14, recentLimit = 20 } = {}) {
  const since = startOfDay(new Date(Date.now() - (days - 1) * 86400000));
  const [events, totalViews, totalDownloads, totalUploads, totalApi] = await Promise.all([
    AnalyticsEvent.findAll({
      where: { createdAt: { [Op.gte]: since } },
      order: [['createdAt', 'DESC']],
      limit: 25000,
    }),
    AnalyticsEvent.count({ where: { type: 'view' } }),
    AnalyticsEvent.count({ where: { type: 'download' } }),
    AnalyticsEvent.count({ where: { type: 'upload' } }),
    AnalyticsEvent.count({ where: { channel: 'api' } }),
  ]);

  const buckets = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86400000);
    buckets.set(dayKey(d), {
      key: dayKey(d),
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      views: 0,
      downloads: 0,
      total: 0,
    });
  }

  const visitors = new Set();
  const perFile = new Map();
  let rangeViews = 0;
  let rangeDownloads = 0;
  let rangeUploads = 0;
  let rangeApi = 0;
  let bytesServed = 0;

  for (const e of events) {
    if (e.ip) visitors.add(e.ip);
    const bucket = buckets.get(dayKey(e.createdAt));
    if (bucket) bucket.total += 1;
    if (e.type === 'view') {
      rangeViews += 1;
      if (bucket) bucket.views += 1;
    } else if (e.type === 'download') {
      rangeDownloads += 1;
      bytesServed += Number(e.bytes) || 0;
      if (bucket) bucket.downloads += 1;
    } else if (e.type === 'upload') {
      rangeUploads += 1;
    }
    if (e.channel === 'api') rangeApi += 1;
    if (e.fileId && (e.type === 'view' || e.type === 'download')) {
      const cur = perFile.get(e.fileId) || { id: e.fileId, views: 0, downloads: 0, total: 0 };
      if (e.type === 'view') cur.views += 1;
      cur.downloads += 1;
      cur.total += 1;
      perFile.set(e.fileId, cur);
    }
  }

  const dayList = [...buckets.values()];
  const maxDay = Math.max(1, ...dayList.map((d) => d.total));
  for (const d of dayList) d.pct = Math.round((d.total / maxDay) * 100);

  const topIds = [...perFile.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  const recent = events.slice(0, recentLimit);

  const wantedIds = [...new Set([...topIds.map((t) => t.id), ...recent.map((e) => e.fileId).filter(Boolean)])];
  const records = wantedIds.length ? await FileRecord.findAll({ where: { id: wantedIds } }) : [];
  const names = new Map(records.map((f) => [f.id, f.filename]));

  return {
    days: dayList,
    maxDay,
    totals: {
      views: totalViews,
      downloads: totalDownloads,
      uploads: totalUploads,
      apiRequests: totalApi,
    },
    range: {
      days,
      from: since,
      views: rangeViews,
      downloads: rangeDownloads,
      uploads: rangeUploads,
      api: rangeApi,
      uniqueVisitors: visitors.size,
      bytesServed,
      events: events.length,
    },
    topFiles: topIds.map((t) => ({ ...t, filename: names.get(t.id) || t.id })),
    recent: recent.map((e) => ({
      id: e.id,
      type: e.type,
      channel: e.channel,
      fileId: e.fileId,
      filename: e.fileId ? names.get(e.fileId) || e.fileId : null,
      ip: e.ip,
      referer: e.referer,
      bytes: e.bytes,
      createdAt: e.createdAt,
    })),
  };
}
