export async function handler(event) {
  try {
    const q = (event.queryStringParameters && event.queryStringParameters.q) || ''
    if (!q) return { statusCode: 400, body: JSON.stringify({ error: 'query required' }) }
    let clientId = process.env.NAVER_CLIENT_ID
    let clientSecret = process.env.NAVER_CLIENT_SECRET

    // Fallback: if env not set (local netlify dev), try reading local .env from several likely locations
    if (!clientId || !clientSecret) {
      try {
        const fs = require('fs')
        const path = require('path')
        const candidates = [
          path.join(process.cwd(), '.env'),
          path.join(__dirname, '.env'),
          path.join(__dirname, '..', '.env'),
          path.join(__dirname, '..', '..', '.env'),
        ]
        for (const envPath of candidates) {
          if (fs.existsSync(envPath)) {
            const raw = fs.readFileSync(envPath, 'utf8')
            raw.split(/\r?\n/).forEach((line) => {
              const m = line.match(/^(NAVER_CLIENT_ID|NAVER_CLIENT_SECRET)=(.*)$/)
              if (m) {
                if (m[1] === 'NAVER_CLIENT_ID' && !clientId) clientId = m[2].trim()
                if (m[1] === 'NAVER_CLIENT_SECRET' && !clientSecret) clientSecret = m[2].trim()
              }
            })
            if (clientId && clientSecret) break
          }
        }
      } catch (e) {
        // ignore
      }
    }

    if (!clientId || !clientSecret) {
      return { statusCode: 500, body: JSON.stringify({ error: 'NAVER_CLIENT_ID/SECRET not configured' }) }
    }

    const url = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(q)}&display=20&start=1`
    const resp = await fetch(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
    })

    if (!resp.ok) {
      const text = await resp.text()
      return { statusCode: resp.status || 500, body: JSON.stringify({ error: text }) }
    }

    const data = await resp.json()
    // normalize minimal fields for frontend
    const items = (data.items || []).map((it) => ({
      title: it.title,
      link: it.link,
      description: it.description,
      bloggername: it.bloggername,
      postdate: it.postdate,
    }))

    return { statusCode: 200, body: JSON.stringify({ query: q, items }) }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) }
  }
}
