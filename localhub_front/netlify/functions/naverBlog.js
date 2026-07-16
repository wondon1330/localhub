import fetch from 'node-fetch'

export async function handler(event) {
  try {
    const q = (event.queryStringParameters && event.queryStringParameters.q) || ''
    if (!q) return { statusCode: 400, body: JSON.stringify({ error: 'query required' }) }

    const clientId = process.env.NAVER_CLIENT_ID
    const clientSecret = process.env.NAVER_CLIENT_SECRET
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
