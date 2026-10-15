import { neon } from '@neondatabase/serverless';

const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const json = (d, s = 200, h = {}) =>
  new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json', ...h } });

async function hash(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256));
}
const sid = req => (/(?:^|; )sid=([a-f0-9]+)/.exec(req.headers.get('cookie') || '') || [])[1];
const cookie = (t, age) => `sid=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`;

async function start(sql, uid) {
  const t = rand(32);
  await sql`INSERT INTO sessions(token_hash, user_id) VALUES(${await sha(t)}, ${uid})`;
  return cookie(t, 2592000);
}
async function userOf(req, sql) {
  const t = sid(req);
  if (!t) return null;
  const r = await sql`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${await sha(t)} AND s.created_at > now() - interval '30 days'`;
  return r[0] || null;
}
function clean(b) {
  const name = String(b.name || '').trim().slice(0, 200);
  const artist = String(b.artist || '').trim().slice(0, 200);
  if (!name || !artist) return null;
  const y = parseInt(b.year, 10);
  const tracks = (Array.isArray(b.tracks) ? b.tracks : []).slice(0, 100).map(t => ({
    name: String(t.name || '').slice(0, 200),
    seconds: Number.isFinite(t.seconds) ? Math.max(0, Math.round(t.seconds)) : null,
  }));
  return {
    name, artist,
    year: y >= 1900 && y <= 2100 ? y : null,
    rating: Math.max(0, Math.min(10, parseInt(b.rating, 10) || 0)),
    barcode: String(b.barcode || '').replace(/\D/g, '').slice(0, 20),
    tracks: JSON.stringify(tracks),
  };
}

async function handle(request, env) {
  const path = new URL(request.url).pathname.split('/').filter(Boolean).slice(1);
  if (path[0] === 'health') return json({ hasDatabaseUrl: !!env.DATABASE_URL, bindingNames: Object.keys(env) });
  if (!env.DATABASE_URL) return json({ error: 'Server is missing DATABASE_URL' }, 500);
  const [a, id] = path;
  const m = request.method;
  const body = m === 'POST' || m === 'PUT' ? await request.json().catch(() => ({})) : {};
  try {
    const sql = neon(env.DATABASE_URL);
    if (a === 'signup' && m === 'POST') {
      const un = String(body.username || '').trim(), pw = String(body.password || '');
      if (!/^[A-Za-z0-9_]{3,20}$/.test(un)) return json({ error: 'Username: 3-20 letters, numbers or _' }, 400);
      if (pw.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const salt = rand(16);
      const r = await sql`INSERT INTO users(username, salt, pass_hash)
        VALUES(${un}, ${salt}, ${await hash(pw, salt)}) ON CONFLICT DO NOTHING RETURNING id`;
      if (!r[0]) return json({ error: 'Username already taken' }, 409);
      return json({ username: un }, 200, { 'set-cookie': await start(sql, r[0].id) });
    }
    if (a === 'login' && m === 'POST') {
      const r = await sql`SELECT id, username, salt, pass_hash FROM users
        WHERE lower(username) = lower(${String(body.username || '')})`;
      const u = r[0];
      if (!u || (await hash(String(body.password || ''), u.salt)) !== u.pass_hash)
        return json({ error: 'Wrong username or password' }, 401);
      return json({ username: u.username }, 200, { 'set-cookie': await start(sql, u.id) });
    }
    if (a === 'logout' && m === 'POST') {
      const t = sid(request);
      if (t) await sql`DELETE FROM sessions WHERE token_hash = ${await sha(t)}`;
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
    }

    const u = await userOf(request, sql);
    if (!u) return json({ error: 'Not signed in' }, 401);
    if (a === 'me') return json({ username: u.username });

    if (a === 'cds') {
      if (m === 'GET' && !id) {
        const rows = await sql`SELECT id, name, artist, year, rating, barcode, tracks FROM cds
          WHERE user_id = ${u.id} ORDER BY created_at DESC`;
        return json({ cds: rows });
      }
      if (m === 'POST' && !id) {
        const c = clean(body);
        if (!c) return json({ error: 'Name and artist are required' }, 400);
        const r = await sql`INSERT INTO cds(user_id, name, artist, year, rating, barcode, tracks)
          VALUES(${u.id}, ${c.name}, ${c.artist}, ${c.year}, ${c.rating}, ${c.barcode}, ${c.tracks}::jsonb)
          RETURNING id`;
        return json({ id: r[0].id });
      }
      if (m === 'PUT' && id) {
        const c = clean(body);
        if (!c) return json({ error: 'Name and artist are required' }, 400);
        const r = await sql`UPDATE cds SET name = ${c.name}, artist = ${c.artist}, year = ${c.year},
          rating = ${c.rating}, barcode = ${c.barcode}, tracks = ${c.tracks}::jsonb
          WHERE id = ${+id} AND user_id = ${u.id} RETURNING id`;
        return r[0] ? json({ ok: true }) : json({ error: 'Not found' }, 404);
      }
      if (m === 'DELETE' && id) {
        const r = await sql`DELETE FROM cds WHERE id = ${+id} AND user_id = ${u.id} RETURNING id`;
        return r[0] ? json({ ok: true }) : json({ error: 'Not found' }, 404);
      }
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    const msg = String((e && e.message) || '');
    if (/does not exist/.test(msg)) return json({ error: 'Database tables missing: run schema.sql in Neon' }, 500);
    if (/connection string|password authentication|ENOTFOUND/i.test(msg)) return json({ error: 'Cannot connect to Neon: check DATABASE_URL' }, 500);
    return json({ error: 'Server error' }, 500);
  }
}

export default { fetch: handle };
