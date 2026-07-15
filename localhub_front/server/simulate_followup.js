const fs = require('fs')
const path = require('path')
const fetch = global.fetch

async function buildFollowups(userQuery) {
  const lower = (userQuery || '').toLowerCase()
  const codeLabels = { FD01: '한식', FD02: '양식/중식', FD03: '베이커리', FD05: '카페' }
  const dataPath = path.join(__dirname, '..', 'src', 'data', '대전_충청권_음식점.json')
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8')).items || []
  const counts = {}
  for (const it of data) {
    const code = it.lclsSystm2 || ''
    if (!code) continue
    counts[code] = (counts[code] || 0) + 1
  }
  const byCount = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])
  const options = []
  for (const code of byCount.slice(0,4)) {
    const label = codeLabels[code] || code
    options.push({ label: `${label} 추천`, query: label })
  }
  const keywords = ['국밥','비빔밥','곰탕','갈비','찌개','파스타','칼국수','우동','카페','베이커리']
  for (const k of keywords) {
    if (lower.includes(k)) continue
    const found = data.some(r => (r.title||'').includes(k))
    if (found) options.push({ label: `${k} 찾기`, query: k })
    if (options.length >= 8) break
  }
  const seen = new Set()
  return options.filter(o=>{ if (seen.has(o.query)) return false; seen.add(o.query); return true })
}

async function main(){
  const baseUrl = 'http://localhost:3000/api/chat'
  const testQ = '무의미한질문_xyz_테스트'
  console.log('Sending initial query:', testQ)
  const r = await fetch(baseUrl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({message: testQ}) })
  const j = await r.json()
  console.log('Initial response:', JSON.stringify(j, null, 2))

  if (!j.candidates || j.candidates.length === 0) {
    console.log('No candidates returned — building followups from local JSON')
    const f = await buildFollowups(testQ)
    console.log('Followup options:', f)
    if (f.length > 0) {
      const first = f[0]
      console.log('Simulating click -> sending followup query:', first.query)
      const r2 = await fetch(baseUrl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({message: first.query}) })
      const j2 = await r2.json()
      console.log('Followup response:', JSON.stringify(j2, null, 2))
    }
  } else {
    console.log('Candidates present — UI would render candidate cards.')
  }
}

main().catch(e=>{ console.error('ERROR', e); process.exit(1) })
