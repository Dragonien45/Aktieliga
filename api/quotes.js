export default async function handler(req, res) {
  // Sæt CORS headers så browseren aldrig afvises
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

  const DANISH_TICKERS = {
    VWS: 'VWS.CO',
    GN: 'GN.CO',
    DNORD: 'DNORD.CO'
  };

  const US_TICKERS = ['AMD', 'MSTR', 'GEV', 'TSLA', 'VST', 'SMCI', 'MU', 'FCX', 'VRT'];
  const results = {};

  try {
    // 1. USD/DKK kurs med 2,5 sek timeout
    let usdDkkRate = 6.85;
    try {
      const fxResp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDDKK=X?interval=1d&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(2500)
      });
      if (fxResp.ok) {
        const fxData = await fxResp.json();
        const rate = fxData?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (rate) usdDkkRate = rate;
      }
    } catch (_) {
      // Falder tilbage til 6.85 hvis timeout eller fejl opstår
    }

    // 2. Yahoo Finance (Danske aktier) med 3 sek timeout
    const danishTasks = Object.entries(DANISH_TICKERS).map(async ([symbol, yahooSymbol]) => {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(3000)
        });
        if (resp.ok) {
          const data = await resp.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (meta && meta.regularMarketPrice) {
            const current = meta.regularMarketPrice;
            const prev = meta.chartPreviousClose || meta.previousClose || current;
            results[symbol] = {
              price: parseFloat(current.toFixed(2)),
              changePercent: prev ? parseFloat((((current - prev) / prev) * 100).toFixed(2)) : 0,
              source: 'Yahoo Finance (Server)'
            };
          }
        }
      } catch (err) {
        results[symbol] = { error: err.message };
      }
    });

    // 3. Finnhub (US aktier) med 3 sek timeout
    const usTasks = FINNHUB_API_KEY
      ? US_TICKERS.map(async (symbol) => {
          try {
            const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.c) {
                const priceInDkk = data.c * usdDkkRate;
                results[symbol] = {
                  price: parseFloat(priceInDkk.toFixed(2)),
                  priceUSD: data.c,
                  changePercent: data.dp !== null ? parseFloat(data.dp.toFixed(2)) : 0,
                  source: 'Finnhub (Server)'
                };
              }
            }
          } catch (err) {
            results[symbol] = { error: err.message };
          }
        })
      : US_TICKERS.map(s => {
          results[s] = { error: 'FINNHUB_API_KEY mangler' };
        });

    // Afvent alle kald parallelt (maks 3 sekunder samlet)
    await Promise.all([...danishTasks, ...usTasks]);

    // Send altid svar tilbage inden for få sekunder
    return res.status(200).json({
      timestamp: new Date().toISOString(),
      usdDkkRate,
      data: results
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
