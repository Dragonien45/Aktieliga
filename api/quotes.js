export default async function handler(req, res) {
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

  // Tjek om de respektive børser er åbne i dansk tid (CET/CEST)
  const now = new Date();
  const cphFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Copenhagen',
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric'
  });
  const parts = cphFormatter.formatToParts(now);
  const partMap = {};
  parts.forEach(p => partMap[p.type] = p.value);

  const isWeekday = !['Sat', 'Sun'].includes(partMap.weekday);
  const hour = parseInt(partMap.hour, 10);
  const min = parseInt(partMap.minute, 10);
  const timeVal = hour + (min / 60);

  const dkOpen = isWeekday && timeVal >= 9.0 && timeVal < 17.0;
  const usOpen = isWeekday && timeVal >= 15.5 && timeVal < 22.0;

  // Standard aktier fra duellen
  const DEFAULT_DANISH = {
    VWS: 'VWS.CO',
    GN: 'GN.CO',
    DNORD: 'DNORD.CO'
  };

  const DEFAULT_US = ['AMD', 'MSTR', 'GEV', 'TSLA', 'VST', 'SMCI', 'MU', 'FCX', 'VRT'];

  let requestedSymbols = [];
  if (req.query.symbols) {
    requestedSymbols = req.query.symbols
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
  }

  const allSymbolsToFetch = new Set([
    ...Object.keys(DEFAULT_DANISH),
    ...Object.values(DEFAULT_DANISH),
    ...DEFAULT_US,
    ...requestedSymbols
  ]);

  const results = {};

  try {
    // TRIN 1: Hent USD/DKK valutakurs fra Yahoo Finance
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

    // TRIN 2: Hent aktiekurser fra Yahoo Finance
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

        const priceInDkk = isDkk ? currentPrice : currentPrice * usdDkkRate;
        const priceInUsd = isDkk ? (currentPrice / usdDkkRate) : currentPrice;

        return {
          price: parseFloat(priceInDkk.toFixed(2)),
          priceUSD: parseFloat(priceInUsd.toFixed(2)),
          changePercent: parseFloat(chgPct.toFixed(2)),
          currency: isDkk ? 'DKK' : 'USD',
          name: meta.shortName || meta.longName || symbol,
          exchangeName: meta.exchangeName || (isDkk ? 'CPH' : 'US'),
          source: isDkk ? (dkOpen ? 'Yahoo CPH (Åben)' : 'Lukkekurs (DK Lukket)') : (usOpen ? 'Yahoo US (Åben)' : 'Lukkekurs (US Lukket)'),
          isOpen: isDkk ? dkOpen : usOpen
        };
      } catch (e) {
        return null;
      }
    };

    // TRIN 3: Hent kurser for alle aktier parallelt
    const fetchTasks = Array.from(allSymbolsToFetch).map(async (rawSymbol) => {
      let lookupSymbol = rawSymbol;
      if (DEFAULT_DANISH[rawSymbol]) {
        lookupSymbol = DEFAULT_DANISH[rawSymbol];
      }

      const quoteData = await fetchFromYahoo(lookupSymbol);
      if (quoteData) {
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
      marketStatus: { dkOpen, usOpen },
      data: results
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
