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
        let payload = { model, messages, max_tokens: opts.max_tokens || 700, temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2 }
        let resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_KEY}`,
          },
          body: JSON.stringify(payload),
        })
        let text = await resp.text()
        if (!resp.ok && typeof text === 'string' && text.includes('max_tokens') && text.includes('not supported')) {
          // retry with max_completion_tokens
          try {
            delete payload.max_tokens
            payload.max_completion_tokens = opts.max_tokens || 700
            resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` }, body: JSON.stringify(payload) })
            text = await resp.text()
          } catch (e) {}
        }
        if (!resp.ok) {
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

    return { statusCode: 500, body: JSON.stringify({ error: 'No OpenAI model succeeded', reason: 'see function logs for per-model errors (access or unsupported parameters).' }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) }
  }
}
