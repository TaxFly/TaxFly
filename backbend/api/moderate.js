export default async function handler(req, res) {
  // Allow CORS from your frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { imageBase64, mediaType = 'image/jpeg' } = req.body;

  if (!imageBase64) {
    return res.status(400).json({ error: 'Missing imageBase64' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: `Eres un moderador de contenido para una app de perfiles. Analizá la imagen y respondé SOLO con un objeto JSON con esta estructura exacta:
{"approved": true|false, "reason": "breve explicación en español"}

Rechazá (approved: false) si la imagen contiene:
- Contenido sexual, desnudez o pornografía (incluyendo genitales)
- Violencia extrema, gore o imágenes perturbadoras
- Personajes de ficción con copyright claro (Disney, Marvel, anime famosos, etc.)
- Logos o marcas registradas como elemento principal
- Contenido de odio, símbolos nazis o extremistas

Aprobá (approved: true) si es una foto de persona real, paisaje, mascota, ilustración genérica, o similar.
No incluyas texto fuera del JSON.`,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 }
            },
            {
              type: 'text',
              text: '¿Esta imagen es apropiada para un avatar de perfil de usuario?'
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic error:', err);
      return res.status(502).json({ error: 'Upstream API error', detail: err });
    }

    const data = await response.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
