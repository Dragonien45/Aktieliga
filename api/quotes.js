export default async function handler(req, res) {
  // CORS og cache headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Kun GET tilladt' });
  }

  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

  // De 3 danske aktier hentes via Yahoo Finance i DKK
  const DANISH_TICKERS = {
    VWS: 'VWS.CO',
    GN: 'GN.CO',
    DNORD: 'DNORD.CO'
  };

  // De 9 amerikanske aktier hentes via Finnhub i USD
  const US_TICKERS = ['AMD', 'MSTR', 'GEV', 'TSLA', 'VST', 'SMCI', 'MU', 'FCX', 'VRT'];

  const results = {};

  try {
    // TRIN 1: Hent officiel USD/DKK valutakurs fra Yahoo
    let usdDkkRate = 6.85;
    try {
      const fxResp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDDKK=X?interval=1d&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(3000)
      });
      if (fxResp.ok) {
        const fxJson = await fxResp.json();
        const liveFx = fxJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (liveFx && liveFx > 5 && liveFx < 10) {
          usdDkkRate = liveFx;
        }
      }
    } catch (e) {
      console.warn('Brugte standard USD/DKK kurs (6.85)');
    }

    // TRIN 2: Hent danske aktier parallelt fra Yahoo
    const danishTasks = Object.entries(DANISH_TICKERS).map(async ([ticker, yahooSymbol]) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(3500)
        });
        if (resp.ok) {
          const d = await resp.json();
          const meta = d?.chart?.result?.[0]?.meta;
          if (meta && meta.regularMarketPrice) {
            const current = meta.regularMarketPrice;
            const prev = meta.chartPreviousClose || meta.previousClose || current;
            const chgPct = prev ? ((current - prev) / prev) * 100 : 0;

            results[ticker] = {
              price: parseFloat(current.toFixed(2)),
              priceUSD: null,
              changePercent: parseFloat(chgPct.toFixed(2)),
              currency: 'DKK',
              source: 'Yahoo Finance (CPH)'
            };
          }
        }
      } catch (err) {
        results[ticker] = { error: err.message };
      }
    });

    // TRIN 3: Hent amerikanske aktier parallelt fra Finnhub
    const usTasks = US_TICKERS.map(async (ticker) => {
      if (!FINNHUB_API_KEY) {
        results[ticker] = { error: 'FINNHUB_API_KEY mangler i Vercel' };
        return;
      }
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (resp.ok) {
          const data = await resp.json();
          if (data && typeof data.c === 'number' && data.c > 0) {
            const priceInDkk = data.c * usdDkkRate;
            results[ticker] = {
              price: parseFloat(priceInDkk.toFixed(2)),
              priceUSD: parseFloat(data.c.toFixed(2)),
              changePercent: data.dp !== null && data.dp !== undefined ? parseFloat(data.dp.toFixed(2)) : 0,
              currency: 'USD',
              source: 'Finnhub (US)'
            };
          }
        }
      } catch (err) {
        results[ticker] = { error: err.message };
      }
    });

    // Vent på at samtlige 12 kurser er færdige
    await Promise.allSettled([...danishTasks, ...usTasks]);

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      usdDkkRate: parseFloat(usdDkkRate.toFixed(4)),
      data: results
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
