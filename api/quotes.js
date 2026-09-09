export default async function handler(request) {
  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

  const DANISH_TICKERS = {
    VWS: 'VWS.CO',
    GN: 'GN.CO',
    DNORD: 'DNORD.CO'
  };

  const US_TICKERS = ['AMD', 'MSTR', 'GEV', 'TSLA', 'VST', 'SMCI', 'MU', 'FCX', 'VRT'];
  const results = {};

  // 1. Valutakurs med 3 sekunders timeout (falder tilbage på fast kurs hvis langsom)
  let usdDkkRate = 6.85;
  try {
    const fxResp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDDKK=X?interval=1d&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(3000)
    });
    if (fxResp.ok) {
      const fxData = await fxResp.json();
      const rate = fxData?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (rate) usdDkkRate = rate;
    }
  } catch (e) {
    // Fortsætter med standardkursen 6.85
  }

  // 2. Danske aktier via Yahoo Finance (maks 4 sekunder per kald)
  const danishPromises = Object.entries(DANISH_TICKERS).map(async ([symbol, yahooSymbol]) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000)
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
    } catch (e) {
      results[symbol] = { error: e.message };
    }
  });

  // 3. US aktier via Finnhub (maks 4 sekunder per kald)
  const usPromises = FINNHUB_API_KEY
    ? US_TICKERS.map(async (symbol) => {
        try {
          const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
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
        } catch (e) {
          results[symbol] = { error: e.message };
        }
      })
    : US_TICKERS.map(s => {
        results[s] = { error: 'FINNHUB_API_KEY mangler' };
      });

  // Kør alle kald parallelt
  await Promise.all([...danishPromises, ...usPromises]);

  return new Response(
    JSON.stringify({ timestamp: new Date().toISOString(), usdDkkRate, data: results }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=20, stale-while-revalidate=40'
      }
    }
  );
}
