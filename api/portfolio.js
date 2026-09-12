export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Understøtter både Vercel KV og Upstash Redis automatisk
  const rawUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const rawToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const KV_URL = rawUrl ? rawUrl.trim().replace(/^["']|["']$/g, '').replace(/\/$/, '') : null;
  const KV_TOKEN = rawToken ? rawToken.trim().replace(/^["']|["']$/g, '') : null;
  const STORAGE_KEY = 'aktieligaen_shared_portfolios_v1';

  if (req.method === 'GET') {
    if (!KV_URL || !KV_TOKEN) {
      return res.status(200).json({
        source: 'local_fallback',
        connected: false,
        message: 'Vercel Storage / Upstash Redis er ikke tilkoblet endnu.',
        user: null,
        dad: null
      });
    }

    try {
      let portfolio = null;

      // 1. Prøv standard Upstash REST /get/key
      const kvResp = await fetch(`${KV_URL}/get/${STORAGE_KEY}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        signal: AbortSignal.timeout(4000)
      });

      if (kvResp.ok) {
        const data = await kvResp.json();
        portfolio = data.result;
      } else {
        // Fallback til body-style array GET
        const cmdResp = await fetch(KV_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${KV_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(['GET', STORAGE_KEY]),
          signal: AbortSignal.timeout(4000)
        });
        if (cmdResp.ok) {
          const cmdData = await cmdResp.json();
          portfolio = cmdData.result;
        }
      }

      if (typeof portfolio === 'string') {
        try {
          portfolio = JSON.parse(portfolio);
        } catch (e) {}
      }

      return res.status(200).json({
        source: 'cloud_kv',
        connected: true,
        user: portfolio?.user || null,
        dad: portfolio?.dad || null,
        updatedAt: portfolio?.updatedAt || null
      });
    } catch (err) {
      console.warn('Fejl ved læsning fra sky-database:', err.message);
      return res.status(200).json({ source: 'error_fallback', connected: false, error: err.message, user: null, dad: null });
    }
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {}
    }
    const { user, dad } = body || {};

    if (!user || !dad) {
      return res.status(400).json({ error: 'Ugyldigt payload: Både user og dad data er påkrævet' });
    }

    if (!KV_URL || !KV_TOKEN) {
      return res.status(200).json({
        saved: false,
        connected: false,
        source: 'local_only',
        message: 'Data blev kun gemt lokalt. Tilkobl Vercel Storage for at dele mellem computere.'
      });
    }

    try {
      const payload = { user, dad, updatedAt: new Date().toISOString() };
      const payloadString = JSON.stringify(payload);
      
      // Brug Upstash command-array POST (anbefalet af Upstash)
      let kvResp = await fetch(KV_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', STORAGE_KEY, payloadString]),
        signal: AbortSignal.timeout(5000)
      });

      if (!kvResp.ok) {
        // Fallback til /set/${STORAGE_KEY}
        kvResp = await fetch(`${KV_URL}/set/${STORAGE_KEY}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${KV_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: payloadString,
          signal: AbortSignal.timeout(5000)
        });
        if (!kvResp.ok) throw new Error(`KV SET HTTP ${kvResp.status}`);
      }

      return res.status(200).json({
        saved: true,
        connected: true,
        source: 'cloud_kv',
        timestamp: payload.updatedAt
      });
    } catch (err) {
      console.error('Fejl ved skrivning til sky-database:', err.message);
      return res.status(500).json({ error: err.message, saved: false, connected: true });
    }
  }

  return res.status(405).json({ error: 'Kun GET og POST tilladt' });
}
