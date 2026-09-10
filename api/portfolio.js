export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Understøtter både Vercel KV og Upstash Redis automatisk
  const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const STORAGE_KEY = 'aktieligaen_shared_portfolios_v1';

  if (req.method === 'GET') {
    if (!KV_URL || !KV_TOKEN) {
      return res.status(200).json({
        source: 'local_fallback',
        message: 'Vercel Storage er ikke tilkoblet endnu. Læs vejledningen for 1-klik opsætning.',
        user: null,
        dad: null
      });
    }

    try {
      const kvResp = await fetch(`${KV_URL}/get/${STORAGE_KEY}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        signal: AbortSignal.timeout(3500)
      });

      if (!kvResp.ok) throw new Error(`KV HTTP ${kvResp.status}`);

      const data = await kvResp.json();
      let portfolio = data.result;

      if (typeof portfolio === 'string') {
        try {
          portfolio = JSON.parse(portfolio);
        } catch (e) {}
      }

      return res.status(200).json({
        source: 'cloud_kv',
        user: portfolio?.user || null,
        dad: portfolio?.dad || null
      });
    } catch (err) {
      console.warn('Fejl ved læsning fra sky-database:', err.message);
      return res.status(200).json({ source: 'error_fallback', error: err.message, user: null, dad: null });
    }
  }

  if (req.method === 'POST') {
    const { user, dad } = req.body || {};

    if (!user || !dad) {
      return res.status(400).json({ error: 'Ugyldigt payload: Både user og dad data er påkrævet' });
    }

    if (!KV_URL || !KV_TOKEN) {
      return res.status(200).json({
        saved: false,
        source: 'local_only',
        message: 'Data blev kun gemt lokalt. Tilkobl Vercel Storage for at dele mellem computere.'
      });
    }

    try {
      const payloadString = JSON.stringify({ user, dad, updatedAt: new Date().toISOString() });
      
      const kvResp = await fetch(`${KV_URL}/set/${STORAGE_KEY}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: payloadString,
        signal: AbortSignal.timeout(4000)
      });

      if (!kvResp.ok) throw new Error(`KV SET HTTP ${kvResp.status}`);

      return res.status(200).json({
        saved: true,
        source: 'cloud_kv',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Fejl ved skrivning til sky-database:', err.message);
      return res.status(500).json({ error: err.message, saved: false });
    }
  }

  return res.status(405).json({ error: 'Kun GET og POST tilladt' });
}
