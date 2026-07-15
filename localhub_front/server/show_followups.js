const fs = require('fs')
const path = require('path')

function buildFollowupsLocal(userQuery) {
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

const queries = ['안녕', '한식 추천', '면류 추천', '카페 추천', '무의미질문_xyz']
for (const q of queries) {
  console.log('Query:', q)
  console.log(buildFollowupsLocal(q))
  console.log('---')
}
