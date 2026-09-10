export default async function handler(req, res) {
  // CORS og cache headers (cachet i 30s på edge, 60s stale-while-revalidate)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Kun GET tilladt' });
  }

  // Standard aktier fra duellen
  const DEFAULT_DANISH = {
    VWS: 'VWS.CO',
    GN: 'GN.CO',
    DNORD: 'DNORD.CO'
  };

  const DEFAULT_US = ['AMD', 'MSTR', 'GEV', 'TSLA', 'VST', 'SMCI', 'MU', 'FCX', 'VRT'];

  // Læs dynamiske symboler fra URL parameteren ?symbols=NVDA,NOVO-B.CO,...
  let requestedSymbols = [];
  if (req.query.symbols) {
    requestedSymbols = req.query.symbols
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
  }

  // Saml alle symboler (standard aktier + dynamisk tilføjede)
  const allSymbolsToFetch = new Set([
    ...Object.keys(DEFAULT_DANISH),
    ...Object.values(DEFAULT_DANISH),
    ...DEFAULT_US,
    ...requestedSymbols
  ]);

  const results = {};

  try {
    // TRIN 1: Hent officiel USD/DKK valutakurs fra Yahoo Finance
    let usdDkkRate = 6.85;
    try {
      const fxResp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDDKK=X?interval=1d&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(3500)
      });
      if (fxResp.ok) {
        const fxJson = await fxResp.json();
        const liveFx = fxJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (liveFx && liveFx > 5 && liveFx < 10) {
          usdDkkRate = liveFx;
        }
      }
    } catch (e) {
      console.warn('Brugte fallback USD/DKK kurs (6.85)');
    }

    // TRIN 2: Universel Yahoo Finance fetcher for alle markeder (DKK, USD, EUR mv.)
    const fetchFromYahoo = async (symbol) => {
      try {
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
        const resp = await fetch(yahooUrl, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(4000)
        });

        if (!resp.ok) return null;
        const d = await resp.json();
        const meta = d?.chart?.result?.[0]?.meta;
        if (!meta || typeof meta.regularMarketPrice !== 'number') return null;

        const currentPrice = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || meta.previousClose || currentPrice;
        const chgPct = prev ? ((currentPrice - prev) / prev) * 100 : 0;
        const currency = (meta.currency || '').toUpperCase();
        const isDkk = currency === 'DKK' || symbol.endsWith('.CO');

        // Omregning til DKK hvis aktien handles i USD
        const priceInDkk = isDkk ? currentPrice : currentPrice * usdDkkRate;
        const priceInUsd = isDkk ? (currentPrice / usdDkkRate) : currentPrice;

        return {
          price: parseFloat(priceInDkk.toFixed(2)),
          priceUSD: parseFloat(priceInUsd.toFixed(2)),
          changePercent: parseFloat(chgPct.toFixed(2)),
          currency: isDkk ? 'DKK' : 'USD',
          name: meta.shortName || meta.longName || symbol,
          exchangeName: meta.exchangeName || (isDkk ? 'CPH' : 'US'),
          source: isDkk ? 'Yahoo Finance (CPH)' : 'Yahoo Finance (US)'
        };
      } catch (e) {
        return null;
      }
    };

    // TRIN 3: Hent kurser for samtlige aktier parallelt
    const fetchTasks = Array.from(allSymbolsToFetch).map(async (rawSymbol) => {
      // Hvis symbolet er en kendt dansk aktie (fx VWS), tilføj Københavns-børs endelsen (.CO)
      let lookupSymbol = rawSymbol;
      if (DEFAULT_DANISH[rawSymbol]) {
        lookupSymbol = DEFAULT_DANISH[rawSymbol];
      }

      const quoteData = await fetchFromYahoo(lookupSymbol);
      if (quoteData) {
        // Gem under både opslagssymbolet og basis-tickeren
        results[rawSymbol] = quoteData;
        results[lookupSymbol] = quoteData;

        const baseSymbol = rawSymbol.replace(/\.CO$/i, '');
        results[baseSymbol] = quoteData;
      } else {
        results[rawSymbol] = { error: `Kunne ikke hente kurs for ${rawSymbol}` };
      }
    });

    await Promise.allSettled(fetchTasks);

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      usdDkkRate: parseFloat(usdDkkRate.toFixed(4)),
      source: 'Yahoo Finance 100% Live',
      data: results
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
