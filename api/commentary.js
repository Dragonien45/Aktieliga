export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Kun POST tilladt' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY mangler i Vercel Environment Variables' });
  }

  const { userTotal, dadTotal, diff, userPnlPct, dadPnlPct, userHoldings, dadHoldings } = req.body;

  const prompt = `Du er en skarp, humoristisk og indsigtsfuld dansk finanskommentator (som fra Euroinvestor Millionærklubben).
Giv en lynhurtig closing-bell status på duellen i Aktieligaen mellem Karl (søn, Teampogi2300) og Kim (far) pr. kl. 19:00 CEST.

Tal:
- Karl (Teampogi2300): ${userTotal?.toLocaleString('da-DK')} DKK (${userPnlPct >= 0 ? '+' : ''}${userPnlPct?.toFixed(2)}%)
- Kim (Far): ${dadTotal?.toLocaleString('da-DK')} DKK (${dadPnlPct >= 0 ? '+' : ''}${dadPnlPct?.toFixed(2)}%)
- Forskellen er: ${diff >= 0 ? `Karl fører med +${diff?.toLocaleString('da-DK')} DKK` : `Kim fører med +${Math.abs(diff)?.toLocaleString('da-DK')} DKK`}
- Karls aktier: ${userHoldings?.join(', ')}
- Kims aktier: ${dadHoldings?.join(', ')}

Skriv 3-4 velskrevne sætninger i én samlet tekst (uden punktopstilling). Nævn hvem der fører, med hvor meget, hvilke typer aktier der driver det, og giv en lille stikpille om håneretten ved middagsbordet.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API svarede med HTTP ${response.status}`);
    }

    const data = await response.json();
    const commentary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    return res.status(200).json({ commentary });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
