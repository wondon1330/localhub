module.exports.handler = async function (event) {
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
    if (!OPENAI_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'OpenAI key not configured' }) }

    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {}
    const messages = body.messages || []
    const opts = body.opts || {}
    const modelsToTry = opts.models || ['gpt-5-mini', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo']

    for (const model of modelsToTry) {
      try {
        const payload = { model, messages, max_tokens: opts.max_tokens || 700, temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2 }
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_KEY}`,
          },
          body: JSON.stringify(payload),
        })
        const text = await resp.text()
        if (!resp.ok) {
          // try next model
          console.warn('OpenAI returned', resp.status, text)
          continue
        }
        const data = JSON.parse(text)
        return { statusCode: 200, body: JSON.stringify({ model, data }) }
      } catch (err) {
        console.warn('openai proxy model failed', model, err?.message || err)
        continue
      }
    }

    return { statusCode: 500, body: JSON.stringify({ error: 'No OpenAI model succeeded' }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) }
  }
}
