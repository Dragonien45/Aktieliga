export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

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

  // Nasdaq Copenhagen åbningstid: 09:00 - 17:00 dansk tid på hverdage
  const dkOpen = isWeekday && timeVal >= 9.0 && timeVal < 17.0;
  // US Markeder (NYSE/NASDAQ): 15:30 - 22:00 dansk tid på hverdage
  const usOpen = isWeekday && timeVal >= 15.5 && timeVal < 22.0;

  // Omfattende ordbog over populære og OMX C25 danske aktier
  const DANISH_TICKERS = {
    'VWS': 'VWS.CO',
    'GN': 'GN.CO',
    'DNORD': 'DNORD.CO',
    'NOVO-B': 'NOVO-B.CO',
    'NOVO B': 'NOVO-B.CO',
    'NOVOB': 'NOVO-B.CO',
    'NOVO': 'NOVO-B.CO',
    'CARL-B': 'CARL-B.CO',
    'CARL B': 'CARL-B.CO',
    'CARLB': 'CARL-B.CO',
    'CARLSBERG': 'CARL-B.CO',
    'DSV': 'DSV.CO',
    'MAERSK-B': 'MAERSK-B.CO',
    'MAERSK B': 'MAERSK-B.CO',
    'MAERSKB': 'MAERSK-B.CO',
    'MAERSK-A': 'MAERSK-A.CO',
    'MAERSK A': 'MAERSK-A.CO',
    'MAERSKA': 'MAERSK-A.CO',
    'MAERSK': 'MAERSK-B.CO',
    'ORSTED': 'ORSTED.CO',
    'ØRSTED': 'ORSTED.CO',
    'PNDORA': 'PNDORA.CO',
    'PANDORA': 'PNDORA.CO',
    'DEMANT': 'DEMANT.CO',
    'TRYG': 'TRYG.CO',
    'DANSKE': 'DANSKE.CO',
    'COLO-B': 'COLO-B.CO',
    'COLO B': 'COLO-B.CO',
    'COLOB': 'COLO-B.CO',
    'COLOPLAST': 'COLO-B.CO',
    'GEN': 'GEN.CO',
    'GMAB': 'GEN.CO',
    'GENMAB': 'GEN.CO',
    'BAVA': 'BAVA.CO',
    'BAVARIAN': 'BAVA.CO',
    'ISS': 'ISS.CO',
    'ROCK-B': 'ROCK-B.CO',
    'ROCK B': 'ROCK-B.CO',
    'ROCKB': 'ROCK-B.CO',
    'ROCKWOOL': 'ROCK-B.CO',
    'RBREW': 'RBREW.CO',
    'ROYAL UNIBREW': 'RBREW.CO',
    'NETC': 'NETC.CO',
    'NETCOMPANY': 'NETC.CO',
    'TOP': 'TOP.CO',
    'TOPDANMARK': 'TOP.CO',
    'FLS': 'FLS.CO',
    'FLSMIDTH': 'FLS.CO',
    'ZEAL': 'ZEAL.CO',
    'ZEALAND': 'ZEAL.CO',
    'NKT': 'NKT.CO',
    'AMBU-B': 'AMBU-B.CO',
    'AMBU B': 'AMBU-B.CO',
    'AMBU': 'AMBU-B.CO',
    'AMBUB': 'AMBU-B.CO',
    'JYSK': 'JYSK.CO',
    'JYSKE': 'JYSK.CO',
    'SYDB': 'SYDB.CO',
    'SYDBANK': 'SYDB.CO',
    'RILBA': 'RILBA.CO',
    'ALMB': 'ALMB.CO',
    'ALM BRAND': 'ALMB.CO',
    'TRMD': 'TRMD.CO',
    'TORM': 'TRMD.CO',
    'SCHO': 'SCHO.CO',
    'SPNO': 'SPNO.CO',
    'SPAR NORD': 'SPNO.CO',
    'CHEMM': 'CHEMM.CO',
    'CHEMOMETEC': 'CHEMM.CO',
    'NTG': 'NTG.CO',
    'SIM': 'SIM.CO',
    'SIMCORP': 'SIM.CO',
    'JDAN': 'JDAN.CO',
    'JEUDAN': 'JDAN.CO',
    'TDC': 'TDC.CO'
  };

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
      .map(s => s.trim())
      .filter(Boolean);
  }

  try {
    // TRIN 1: Hent USD/DKK og EUR/DKK valutakurser
    let usdDkkRate = 6.85;
    let eurDkkRate = 7.46;

    try {
      const fxResp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDDKK=X?interval=1d&range=1d', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(4000)
      });
      if (fxResp.ok) {
        const fxJson = await fxResp.json();
        const liveFx = fxJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (liveFx && liveFx > 4 && liveFx < 12) {
          usdDkkRate = liveFx;
        }
      }
    } catch (e) {
      // Brug standard 6.85
    }

    // TRIN 2: Intelligent Ticker Resolver (finder korrekt Yahoo symbol)
    const resolveToYahooSymbol = (raw) => {
      if (!raw) return raw;
      const clean = raw.trim().toUpperCase();
      
      // Hvis den allerede har .CO eller andet børs-suffix (fx .DE, .L, .ST)
      if (clean.includes('.')) {
        return clean;
      }

      // Tjek direkte i den udvidede danske ordbog
      if (DANISH_TICKERS[clean]) {
        return DANISH_TICKERS[clean];
      }

      const withHyphen = clean.replace(/\s+/g, '-');
      if (DANISH_TICKERS[withHyphen]) {
        return DANISH_TICKERS[withHyphen];
      }

      return clean;
    };

    // TRIN 3: Hent aktiekurser fra Yahoo Finance med failover (query1 -> query2)
    const fetchFromYahoo = async (symbol) => {
      const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

      for (const host of hosts) {
        try {
          const yahooUrl = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
          const resp = await fetch(yahooUrl, {
            headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(6000)
          });

          if (!resp.ok) continue;
          const d = await resp.json();
          const meta = d?.chart?.result?.[0]?.meta;
          if (!meta) continue;

          // Robust udtræk af realtidspris:
          // 1) regularMarketPrice i meta
          // 2) seneste handlede lukkekurs i indicators.quote[0].close
          // 3) chartPreviousClose / previousClose
          let currentPrice = meta.regularMarketPrice;
          const quoteIndicators = d?.chart?.result?.[0]?.indicators?.quote?.[0];

          if (typeof currentPrice !== 'number' || currentPrice <= 0) {
            if (Array.isArray(quoteIndicators?.close)) {
              for (let i = quoteIndicators.close.length - 1; i >= 0; i--) {
                const closeVal = quoteIndicators.close[i];
                if (typeof closeVal === 'number' && closeVal > 0) {
                  currentPrice = closeVal;
                  break;
                }
              }
            }
          }

          if (typeof currentPrice !== 'number' || currentPrice <= 0) {
            currentPrice = meta.chartPreviousClose || meta.previousClose;
          }

          if (typeof currentPrice !== 'number' || currentPrice <= 0) continue;

          const prev = meta.chartPreviousClose || meta.previousClose || currentPrice;
          const chgPct = prev ? ((currentPrice - prev) / prev) * 100 : 0;
          const currency = (meta.currency || '').toUpperCase();
          const exchangeName = (meta.exchangeName || '').toUpperCase();
          const isDkk = currency === 'DKK' || exchangeName === 'CPH' || symbol.toUpperCase().endsWith('.CO');

          let priceInDkk = currentPrice;
          let priceInUsd = currentPrice;

          if (isDkk) {
            priceInDkk = currentPrice;
            priceInUsd = currentPrice / usdDkkRate;
          } else if (currency === 'EUR') {
            priceInDkk = currentPrice * eurDkkRate;
            priceInUsd = (currentPrice * eurDkkRate) / usdDkkRate;
          } else {
            // Standard US / USD
            priceInDkk = currentPrice * usdDkkRate;
            priceInUsd = currentPrice;
          }

          return {
            price: parseFloat(priceInDkk.toFixed(2)),
            rawPrice: parseFloat(currentPrice.toFixed(2)),
            priceUSD: parseFloat(priceInUsd.toFixed(2)),
            changePercent: parseFloat(chgPct.toFixed(2)),
            currency: isDkk ? 'DKK' : (currency || 'USD'),
            name: meta.shortName || meta.longName || symbol,
            exchangeName: isDkk ? 'CPH' : (exchangeName || 'US'),
            symbol: meta.symbol || symbol,
            isDK: isDkk,
            source: isDkk ? (dkOpen ? 'Yahoo CPH (Live)' : 'Lukkekurs (CPH Lukket)') : (usOpen ? 'Yahoo US (Live)' : 'Lukkekurs (US Lukket)'),
            isOpen: isDkk ? dkOpen : usOpen
          };
        } catch (e) {
          // Prøv næste Yahoo host
        }
      }

      return null;
    };

    // TRIN 4: Søg via Yahoo Search API hvis en ticker/virksomhed ikke kan findes direkte
    const searchYahooFallback = async (query) => {
      try {
        const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0`;
        const resp = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(4000)
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const quotes = data?.quotes || [];
        if (!quotes.length) return null;

        // Foretræk en dansk notering (.CO eller CPH) hvis tilgængelig
        const cphMatch = quotes.find(q => q.symbol && (q.symbol.endsWith('.CO') || q.exchange === 'CPH'));
        if (cphMatch) return cphMatch.symbol;

        // Ellers tag den første aktie (EQUITY)
        const equityMatch = quotes.find(q => q.quoteType === 'EQUITY');
        return equityMatch?.symbol || quotes[0]?.symbol || null;
      } catch (e) {
        return null;
      }
    };

    // TRIN 5: Opbyg unik liste over symboler og map originale forespørgsler
    const rawToResolvedMap = new Map();
    const allInputSymbols = [
      ...Object.keys(DEFAULT_DANISH),
      ...Object.values(DEFAULT_DANISH),
      ...DEFAULT_US,
      ...requestedSymbols
    ];

    allInputSymbols.forEach(raw => {
      const upper = raw.trim().toUpperCase();
      const resolved = resolveToYahooSymbol(upper);
      rawToResolvedMap.set(raw, resolved);
      rawToResolvedMap.set(upper, resolved);
    });

    const uniqueYahooSymbolsToFetch = [...new Set(rawToResolvedMap.values())];
    const results = {};

    // TRIN 6: Hent data for alle unikke symboler parallelt
    await Promise.allSettled(
      uniqueYahooSymbolsToFetch.map(async (yahooSym) => {
        let quote = await fetchFromYahoo(yahooSym);

        // Hvis den fejlede og ikke har .CO, prøv automatisk at tilføje .CO (dansk notering)
        if (!quote && !yahooSym.includes('.')) {
          const dkAlternative = `${yahooSym}.CO`;
          quote = await fetchFromYahoo(dkAlternative);
        }

        // Hvis den stadig ikke findes, prøv Yahoo Search autocomplete
        if (!quote) {
          const foundSymbol = await searchYahooFallback(yahooSym);
          if (foundSymbol && foundSymbol !== yahooSym) {
            quote = await fetchFromYahoo(foundSymbol);
          }
        }

        if (quote) {
          results[yahooSym] = quote;
          if (quote.symbol) results[quote.symbol] = quote;
          const cleanBase = yahooSym.replace(/\.CO$/i, '');
          results[cleanBase] = quote;
        } else {
          results[yahooSym] = { error: `Kunne ikke hente kurs for ${yahooSym}` };
        }
      })
    );

    // Kobl de originale requested symboler op på resultaterne
    rawToResolvedMap.forEach((resolved, raw) => {
      const match = results[resolved] || results[resolved.replace(/\.CO$/i, '')];
      if (match) {
        results[raw] = match;
        results[raw.toUpperCase()] = match;
      }
    });

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      usdDkkRate: parseFloat(usdDkkRate.toFixed(4)),
      eurDkkRate: parseFloat(eurDkkRate.toFixed(4)),
      marketStatus: { dkOpen, usOpen },
      data: results
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
