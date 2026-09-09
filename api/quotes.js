export default async function handler(req, res) {
  // Tillad kun GET-forespørgsler
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

  // 1. Definition af aktier
  const DANISH_TICKERS = {
    VWS: 'VWS.CO',
    GN: 'GN.CO',
    DNORD: 'DNORD.CO'
  };

  const US_TICKERS = ['AMD', 'MSTR', 'GEV', 'TSLA', 'VST', 'SMCI', 'MU', 'FCX', 'VRT'];

  const results = {};

  try {
    // 2. Hent danske aktier fra Yahoo Finance på serveren
    await Promise.all(
      Object.entries(DANISH_TICKERS).map(async ([symbol, yahooSymbol]) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
          });

          if (!response.ok) {
            results[symbol] = { error: `Yahoo HTTP ${response.status}` };
            return;
          }

          const data = await response.json();
          const meta = data?.chart?.result?.[0]?.meta;

          if (meta && meta.regularMarketPrice) {
            const current = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose || current;
            const changePercent = prevClose ? ((current - prevClose) / prevClose) * 100 : 0;

            results[symbol] = {
              price: current,
              changePercent: parseFloat(changePercent.toFixed(2)),
              source: 'Yahoo Finance (Server)'
            };
          } else {
            results[symbol] = { error: 'Ugyldigt format fra Yahoo' };
          }
        } catch (err) {
          results[symbol] = { error: err.message };
        }
      })
    );

    // 3. Hent amerikanske aktier fra Finnhub på serveren
    if (!FINNHUB_API_KEY) {
      US_TICKERS.forEach(sym => {
        results[sym] = { error: 'FINNHUB_API_KEY mangler i Environment Variables på Vercel' };
      });
    } else {
      await Promise.all(
        US_TICKERS.map(async (symbol) => {
          try {
            const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
            const response = await fetch(url);

            if (!response.ok) {
              results[symbol] = { error: `Finnhub HTTP ${response.status}` };
              return;
            }

            const data = await response.json();

            // Finnhub returnerer: c = current price, dp = percentage change
            if (data && data.c !== undefined && data.c !== 0) {
              results[symbol] = {
                priceUSD: data.c,
                changePercent: data.dp !== null ? parseFloat(data.dp.toFixed(2)) : 0,
                source: 'Finnhub (Server)'
              };
            } else {
              results[symbol] = { error: 'Ingen kurs returneret fra Finnhub' };
            }
          } catch (err) {
            results[symbol] = { error: err.message };
          }
        })
      );
    }

    // 4. Returner samlet data med CORS-headers og cache-begrænsning
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      timestamp: new Date().toISOString(),
      data: results
    });

  } catch (globalError) {
    return res.status(500).json({ error: globalError.message });
  }
}
