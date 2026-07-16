const express = require('express')
const cors = require('cors')
const puppeteer = require('puppeteer')

const app = express()
app.use(cors())
app.use(express.json())

// Load OPENAI_API_KEY from .env if not present in process.env
if (!process.env.OPENAI_API_KEY) {
  try {
    const fs = require('fs')
    const path = require('path')
    const envPath = path.join(__dirname, '..', '.env')
    if (fs.existsSync(envPath)) {
      const raw = fs.readFileSync(envPath, 'utf8')
      raw.split(/\r?\n/).forEach((line) => {
        const m = line.match(/^(OPENAI_API_KEY|VITE_OPENAI_API_KEY)=(.*)$/)
        if (m) {
          process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || m[2].trim()
        }
      })
    }
  } catch (e) {
    // ignore
  }
}

// Helper to try multiple selectors
async function trySelectors(page, selectors) {
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 1200 })
      const val = await page.$eval(sel, el => el.innerText || el.textContent || '')
      if (val && val.trim().length) return val.trim()
    } catch (e) {
      // continue
    }
  }
  return null
}

const cache = new Map()
const CACHE_TTL = 1000 * 60 * 5 // 5 minutes

app.get('/scrape', async (req, res) => {
  let url = (req.query.url || '').toString()
  const q = (req.query.q || '').toString()
  if (!url && !q) return res.status(400).json({ error: 'url or q required' })

  const cacheKey = url || (`q:${q}`)
  const cached = cache.get(cacheKey)
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return res.json({ url: cached.url, rating: cached.rating, reviewsCount: cached.reviewsCount, ratingText: cached.ratingText, countText: cached.countText, cached: true })
  }

  let browser
  try {
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36')
    if (!url && q) {
      // Try Kakao map search first
      try {
        const kakaoSearch = `https://map.kakao.com/?q=${encodeURIComponent(q)}`
        await page.goto(kakaoSearch, { waitUntil: 'networkidle2', timeout: 20000 })
        const kakaoHref = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a'))
          const p = anchors.find(a => a.href && (a.href.includes('/place/') || a.href.includes('place.map.kakao.com')))
          return p ? p.href : null
        })
        if (kakaoHref) url = kakaoHref
      } catch (e) {}

      // perform search on mobile Naver place site and click first result if Kakao not found
      if (!url) {
        const searchUrl = `https://m.place.naver.com/search/keyword?query=${encodeURIComponent(q)}`
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      }
      // try several selectors for first result (mobile and desktop variations)
      const candidateSelectors = [
        'a.place_entry',
        '.list_area a',
        'a[href*="/place/"]',
        '.search_result_item a',
        '.result_list a',
        '.rcnt a'
      ]
      for (const sel of candidateSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 2500 })
          const href = await page.$eval(sel, a => a.href)
          if (href) { url = href; break }
        } catch (e) {
          // ignore and try next
        }
      }
      // If still not found, try desktop Naver search results
      if (!url) {
        try {
          const desktopSearch = `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`
          await page.goto(desktopSearch, { waitUntil: 'networkidle2', timeout: 10000 })
          // find first link with /place/
          const href = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a'))
            const p = anchors.find(a => a.href && a.href.includes('/place/'))
            return p ? p.href : null
          })
          if (href) url = href
        } catch (e) {
          // ignore
        }
      }
    }
    if (!url) return res.status(500).json({ error: 'cannot determine place url' })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    // Try common selectors for rating and review count
    const ratingSelectors = [
      '.place_section .score .score_menu .num',
      '.score .rate .num',
      '.score .num',
      '.rating .score',
      '[class*="rate_num"], [class*="rating"]',
      '[aria-label*="평점"], [data-testid*="rating"]'
    ]
    const countSelectors = [
      '.review_count',
      '.score .count',
      '[class*="reviewCount"]',
      '[aria-label*="리뷰"], [data-testid*="review"]'
    ]

    let ratingText = await trySelectors(page, ratingSelectors)
    let countText = await trySelectors(page, countSelectors)

    // fallback: search for patterns like 4.5 or 평점 4.5
    if (!ratingText) {
      const body = await page.content()
      const m = body.match(/([0-9]\.[0-9])/)
      if (m) ratingText = m[1]
    }

    const parseNumber = (s) => {
      if (!s) return null
      const num = s.replace(/[가-힣,()\s]/g, '').match(/\d+\.?\d*/)
      return num ? Number(num[0]) : null
    }

    const rating = parseNumber(ratingText)
    const reviewsCount = countText ? Number((countText || '').replace(/[^0-9]/g, '')) : null

    // cache result
    cache.set(cacheKey, { ts: Date.now(), url, rating, reviewsCount, ratingText, countText })

    res.json({ url, rating, reviewsCount, ratingText, countText })
  } catch (err) {
    console.error('scrape error', err)
    res.status(500).json({ error: String(err) })
  } finally {
    if (browser) await browser.close()
  }
})

// fetch blog content (for Naver blog etc.)
app.get('/fetchBlog', async (req, res) => {
  const url = (req.query.url || '').toString()
  if (!url) return res.status(400).json({ error: 'url required' })
  let browser
  try {
    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36')
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })

    // try common blog content selectors
    const selectors = ['div.se-main-container', '#postViewArea', '.se_component_wrap', '.post_ct', '.blog_content']
    let content = ''
    for (const s of selectors) {
      try {
        const exists = await page.$(s)
        if (exists) {
          content = await page.$eval(s, el => el.innerText || el.textContent || '')
          if (content && content.trim().length > 50) break
        }
      } catch (e) {}
    }
    if (!content) {
      // fallback: grab visible body text
      content = await page.evaluate(() => document.body.innerText || '')
    }

    res.json({ url, content: content.slice(0, 20000) })
  } catch (err) {
    console.error('fetchBlog error', err)
    res.status(500).json({ error: String(err) })
  } finally {
    if (browser) await browser.close()
  }
})

// Simple OpenAI proxy on local scraper server to avoid client-side CORS/key exposure
app.post('/openai', express.json(), async (req, res) => {
  const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
  if (!OPENAI_KEY) return res.status(500).json({ error: 'OpenAI key not configured' })
  const messages = req.body.messages || []
  const opts = req.body.opts || {}
  const modelsToTry = opts.models || ['gpt-5-mini', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo']
  for (const model of modelsToTry) {
    try {
      let payload = { model, messages, max_tokens: opts.max_tokens || 700, temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2 }
      // try chat completions endpoint first
      let resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify(payload),
      })
      let text = await resp.text()
      // If server complains about max_tokens, retry with max_completion_tokens
      if (!resp.ok && typeof text === 'string' && text.includes('max_tokens') && text.includes('not supported')) {
        try {
          payload = { ...payload }
          delete payload.max_tokens
          payload.max_completion_tokens = opts.max_tokens || 700
          resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
            body: JSON.stringify(payload),
          })
          text = await resp.text()
        } catch (e) {
          // continue to handle below
        }
      }

      if (!resp.ok) {
        console.warn('OpenAI returned', resp.status, text)
        // if model not found / access denied, skip to next model
        continue
      }

      const data = JSON.parse(text)
      return res.json({ model, data })
    } catch (e) {
      console.warn('openai local proxy failed', model, e?.message || e)
      continue
    }
  }
  return res.status(500).json({ error: 'No OpenAI model succeeded', reason: 'check server logs for per-model errors. Common causes: model access denied or unsupported parameters.' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Scrape server running on http://localhost:${PORT}`))
