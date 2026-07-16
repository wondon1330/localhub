module.exports.handler = async function (event) {
  try {
    const OPENAI_KEY = String(process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY || '').trim().replace(/^['"]|['"]$/g, '')
    if (!OPENAI_KEY) return { statusCode: 500, body: JSON.stringify({ error: 'OpenAI key not configured' }) }

    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {}
    const messages = body.messages || []
    const opts = body.opts || {}
    const fallbackModels = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o']
    const modelsToTry = Array.isArray(opts.models) && opts.models.length ? opts.models : fallbackModels
    let lastError = null

    for (const model of modelsToTry) {
      try {
        let payload = { model, messages, temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2 }
        if (model.includes('gpt-5') || model.includes('gpt-4.1') || model.includes('gpt-4o')) {
          payload.max_completion_tokens = opts.max_tokens || 700
        } else {
          payload.max_tokens = opts.max_tokens || 700
        }

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
          lastError = { status: resp.status, text }
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

    return { statusCode: 500, body: JSON.stringify({ error: 'No OpenAI model succeeded', detail: lastError }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) }
  }
}
