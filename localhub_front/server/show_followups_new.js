const fs = require('fs')
const path = require('path')
const dataPath = path.join(__dirname, '..', 'src', 'data', '대전_충청권_음식점.json')
const data = JSON.parse(fs.readFileSync(dataPath,'utf8')).items || []

function buildFollowupsLocal(userQuery) {
  const lower = (userQuery || '').toLowerCase()
  const targetCategories = ['한식','양식','중식','카페','국밥','고기','비빔밥','면']
  const synonymMap = {
    한식: ['한식','백반','한정식','한식당'],
    양식: ['양식','파스타','스테이크','이탈리안'],
    중식: ['중식','짜장','짬뽕','중화'],
    카페: ['카페','커피','디저트','베이커리'],
    국밥: ['국밥','설렁탕','곰탕'],
    고기: ['고기','구이','삼겹살','갈비','육류'],
    비빔밥: ['비빔밥'],
    면: ['면','국수','칼국수','우동','라면','파스타']
  }
  const options = []
  for (const cat of targetCategories) {
    const syns = synonymMap[cat] || [cat]
    const exists = data.some(r => {
      const title = (r.title||'').toLowerCase()
      return syns.some(s => title.includes(s))
    })
    if (exists) options.push({label:`${cat} 추천`, query:cat})
  }
  // supplement
  if (options.length < 6) {
    const extra = ['국밥','비빔밥','곰탕','갈비','찌개','파스타','칼국수','우동','카페','베이커리']
    for (const k of extra) {
      if (options.some(o=>o.query===k)) continue
      if (data.some(r=> (r.title||'').includes(k))) options.push({label:`${k} 찾기`, query:k})
      if (options.length>=8) break
    }
  }
  // prioritize if user query contains
  for (const cat of targetCategories) {
    const syns = synonymMap[cat] || [cat]
    if (syns.some(s=> lower.includes(s))) {
      const idx = options.findIndex(o=>o.query===cat)
      if (idx>0) {
        const [it]=options.splice(idx,1)
        options.unshift(it)
      }
      break
    }
  }
  return options
}

const queries = ['안녕','한식 추천','면류 추천','카페 추천','무의미질문_xyz']
for (const q of queries) {
  console.log('Query:', q)
  console.log(buildFollowupsLocal(q))
  console.log('---')
}
