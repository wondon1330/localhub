// server/ai-server.js
const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

const app = express()
app.use(cors())
app.use(express.json())

const DATA_PATH = path.join(__dirname, '..', 'src', 'data', '대전_충청권_음식점.json')
let restaurants = []
try {
  const raw = fs.readFileSync(DATA_PATH, 'utf8')
  restaurants = JSON.parse(raw).items || []
} catch (e) {
  console.error('데이터 로드 실패', e)
}
console.log('Loaded restaurants count:', restaurants.length)

function retrieve(query, limit = 6) {
  const q = (query || '').toLowerCase().trim()
  if (!q) return []

  const inferCodes = () => {
    if (q.includes('한식')) return ['FD01']
    if (q.includes('카페') || q.includes('커피')) return ['FD05']
    if (q.includes('베이커리') || q.includes('빵') || q.includes('제과')) return ['FD03']
    if (q.includes('양식') || q.includes('파스타') || q.includes('스테이크') || q.includes('이탈리')) return ['FD02']
    if (q.includes('중식') || q.includes('중국')) return ['FD02']
    return []
  }

  const categoryKeywords = {
    noodles: ['면', '국수', '칼국수', '우동', '라면', '쫄면', '비빔국수', '파스타'],
    korean: ['한식', '백반', '국밥', '곰탕', '설렁탕', '비빔밥'],
    chinese: ['중식', '짜장', '짬뽕', '중화'],
    cafe: ['카페', '커피', '디저트'],
  }

  if (q.includes('면') || q.includes('국수') || q.includes('칼국수') || q.includes('라면') || q.includes('파스타')) {
    const keys = categoryKeywords.noodles
    const direct = restaurants.filter((it) => {
      const t = (it.title || '').toLowerCase()
      return keys.some((k) => t.includes(k))
    })
    if (direct.length) {
      console.log('strict direct filter for noodles ->', direct.length)
      return direct.slice(0, limit)
    }
  }

  const mustMatchKeywords = []
  if (q.includes('면') || q.includes('국수') || q.includes('칼국수') || q.includes('라면') || q.includes('파스타')) {
    mustMatchKeywords.push(...categoryKeywords.noodles)
  }

  const codes = inferCodes()

  const scored = restaurants.map((it) => {
    const hay = [it.title, it.addr1, it.zipcode, it.tel]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    let score = 0
    if (hay.includes(q)) score = 2
    if (it.zipcode && it.zipcode.includes(q)) score = Math.max(score, 2)
    if (codes.length) {
      const codeMatch = codes.some((c) => (it.lclsSystm2 || '').includes(c) || (it.lclsSystm3 || '').includes(c))
      if (codeMatch) score = Math.max(score, 2)
    }
    if (mustMatchKeywords.length) {
      const keywordMatch = mustMatchKeywords.some((k) => hay.includes(k))
      if (keywordMatch) score = Math.max(score, 2)
      else score = 0
    }
    return { item: it, score }
  })
  const results = scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.item)
  console.log('retrieve query="' + query + '" ->', results.length, 'hits')
  if (results.length === 0) {
    if (mustMatchKeywords.length) {
      console.log('strict keyword query with no matches:', mustMatchKeywords)
      return []
    }
    if (q.includes('맛집') || q.includes('추천') || q.includes('추천해')) {
      const withImage = restaurants.filter((it) => (it.firstimage || it.firstimage2)).slice(0, limit)
      const fallback = withImage.length ? withImage : restaurants.slice(0, limit)
      console.log('broad-recommendation for query="' + query + '", returning', fallback.length)
      return fallback
    }
  }
  return results
}

app.post('/api/chat', async (req, res) => {
  try {
    const userMessage = (req.body?.message || '').toString().trim()
    if (!userMessage) return res.status(400).json({ error: 'message required' })

    const POOL_SIZE = 80
    let poolItems = retrieve(userMessage, POOL_SIZE)
    if (!poolItems || poolItems.length === 0) {
      poolItems = restaurants.slice(0, POOL_SIZE)
      console.log('no retrieve hits — providing top', poolItems.length, 'items to LLM')
    } else {
      if (poolItems.length < POOL_SIZE) {
        const ids = new Set(poolItems.map((i) => i.contentid))
        const pad = restaurants.filter((r) => !ids.has(r.contentid)).slice(0, POOL_SIZE - poolItems.length)
        poolItems = poolItems.concat(pad)
      }
    }

    // Ensure pool contains representative items from main categories so LLM can pick flexibly
    const ensureByCode = (code, n = 6) => {
      const have = poolItems.filter((p) => (p.lclsSystm2 || '').includes(code))
      if (have.length >= 1) return
      const extras = restaurants.filter((r) => (r.lclsSystm2 || '').includes(code)).slice(0, n)
      poolItems = poolItems.concat(extras)
    }
    ensureByCode('FD01') // 한식
    ensureByCode('FD02') // 양식/중식
    ensureByCode('FD03') // 베이커리
    ensureByCode('FD05') // 카페

    const itemsForLLM = poolItems.map((it) => ({
      contentid: it.contentid || '',
      title: it.title || '',
      addr1: it.addr1 || '',
      zipcode: it.zipcode || '',
      tel: it.tel || '',
      firstimage: it.firstimage || it.firstimage2 || '',
      category2: it.lclsSystm2 || '',
      category3: it.lclsSystm3 || '',
      mapx: it.mapx || '',
      mapy: it.mapy || '',
    }))

    const systemPrompt = `당신은 대전 지역 음식점 추천 전문가입니다.
사용자 질문을 해석하여, 아래에 제공된 'items' 배열 안에서만 후보를 선택해 최대 6개까지 추천하세요.
반드시 한국어로 간결하게 답변하고, 응답은 정확한 JSON만 반환해야 합니다. 다른 텍스트를 섞지 마세요.

요구 JSON 형식:
{
  "reply": "사용자에게 보낼 간결한 한국어 메시지",
  "candidates": [
    {"contentid":"<contentid>", "title":"","addr1":"","zipcode":"","tel":"","firstimage":"","mapx":"","mapy":""}
  ]
}

지침:
- 절대 'items' 밖의 정보를 후보로 사용하지 마세요. 후보는 반드시 'contentid'로 items에 매핑되어야 합니다.
- 그러나 카테고리 지정이 불명확하거나 실패하면, 제공된 items 중 '유사도'가 가장 높은 항목을 골라 최대 6개를 구성하세요. 즉각적으로 빈 배열을 반환하지 말고 최선의 추천을 만들어야 합니다.
- 사용자가 특정 카테고리를 엄격히 요청하면 그 카테고리와 명확히 일치하는 항목을 우선하세요. 만약 전혀 없으면, 가장 관련성이 높은 항목을 제공하시고 그 사유를 간단히 요약해 주세요.
- 관련 항목이 전혀 없다고 판단되면 "candidates"를 빈 배열로 하고 "reply"에 정확히 이 문구를 넣으세요: "죄송합니다. 대전 지역 음식점 관련 질문을 해주세요."`

    const userPayload = `items:\n${JSON.stringify(itemsForLLM)}\n\n질문: ${userMessage}`

    const modelsToTry = ['gpt-5-mini', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo']
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.warn('OpenAI API key not configured — using local retrieval fallback')
      const q = (userMessage || '').toLowerCase()
      let fallbackHits = retrieve(userMessage, 6)
      // aggressive heuristics when retrieve returns nothing
      if ((!fallbackHits || fallbackHits.length === 0) && q.includes('한식')) {
        fallbackHits = restaurants.filter((r) => (r.lclsSystm2 || '').includes('FD01')).slice(0, 6)
      }
      if ((!fallbackHits || fallbackHits.length === 0) && q.includes('면')) {
        const keys = ['면', '국수', '칼국수', '우동', '라면', '파스타']
        fallbackHits = restaurants.filter((r) => keys.some((k) => (r.title || '').includes(k))).slice(0, 6)
      }
      // last resort: match common korean food words in title
      if ((!fallbackHits || fallbackHits.length === 0)) {
        const common = ['비빔', '불고기', '김치', '국밥', '곰탕', '된장', '한정식', '반찬', '백반']
        fallbackHits = restaurants.filter((r) => common.some((k) => (r.title || '').toLowerCase().includes(k))).slice(0, 6)
      }
      const reply = fallbackHits.length ? '요청하신 기준으로 몇 곳 추천드릴게요.' : '죄송합니다. 대전 지역 음식점 관련 질문을 해주세요.'
      const candidates = fallbackHits.map((it) => ({
        contentid: it.contentid || '',
        title: it.title || '',
        addr1: it.addr1 || '',
        zipcode: it.zipcode || '',
        tel: it.tel || '',
        firstimage: it.firstimage || it.firstimage2 || '',
        mapx: it.mapx || '',
        mapy: it.mapy || '',
      }))
      return res.json({ reply, candidates })
    }

    let aiText = null
    for (const model of modelsToTry) {
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPayload }],
            max_tokens: 700,
            temperature: 0.2,
          }),
        })

        if (!resp.ok) {
          const errText = await resp.text()
          try {
            const errJson = JSON.parse(errText)
            const code = errJson?.error?.code || ''
            if (code === 'model_not_found') {
              console.warn('model_not_found for', model)
              continue
            }
          } catch (e) {
          }
          throw new Error('OpenAI error: ' + errText)
        }

        const data = await resp.json()
        aiText = data?.choices?.[0]?.message?.content
        if (aiText) break
      } catch (e) {
        console.error('OpenAI call failed for model', model, e)
        continue
      }
    }

    if (!aiText) {
      console.log('LLM unavailable — falling back to local retrieve')
      const fallbackHits = retrieve(userMessage, 6)
      const reply = fallbackHits.length ? '요청하신 기준으로 몇 곳 추천드릴게요.' : '죄송합니다. 대전 지역 음식점 관련 질문을 해주세요.'
      const candidates = fallbackHits.map((it) => ({
        contentid: it.contentid || '',
        title: it.title || '',
        addr1: it.addr1 || '',
        zipcode: it.zipcode || '',
        tel: it.tel || '',
        firstimage: it.firstimage || it.firstimage2 || '',
        mapx: it.mapx || '',
        mapy: it.mapy || '',
      }))
      return res.json({ reply, candidates })
    }

    let parsed = null
    try {
      parsed = JSON.parse(aiText)
    } catch (e) {
      console.warn('LLM did not return JSON —', e)
      return res.json({ reply: aiText, candidates: [] })
    }

    const reply = parsed.reply || '죄송합니다. 대전 지역 음식점 관련 질문을 해주세요.'
    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : []

    const byId = new Map(restaurants.map((r) => [String(r.contentid), r]))
    const validated = []
    for (const c of rawCandidates.slice(0, 6)) {
      const id = String(c.contentid || '')
      if (!id) continue
      const full = byId.get(id)
      if (!full) {
        console.warn('LLM candidate contentid not found locally:', id)
        continue
      }
      validated.push({
        contentid: id,
        title: full.title || '',
        addr1: full.addr1 || '',
        zipcode: full.zipcode || '',
        tel: full.tel || '',
        firstimage: full.firstimage || full.firstimage2 || '',
        mapx: full.mapx || '',
        mapy: full.mapy || '',
      })
    }

    if (rawCandidates.length > 0 && validated.length === 0) {
      return res.json({ reply: '죄송합니다. 대전 지역 음식점 관련 질문을 해주세요.', candidates: [] })
    }

    return res.json({ reply, candidates: validated })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: '서버 오류' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`AI server running on http://localhost:${PORT}`)
})
 