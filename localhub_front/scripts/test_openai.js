const fs = require('fs')
const path = require('path')

const dotenvPath = path.join(__dirname, '..', '.env')
let key = ''
if (fs.existsSync(dotenvPath)) {
  const raw = fs.readFileSync(dotenvPath, 'utf8')
  const m = raw.match(/(?:VITE_OPENAI_API_KEY|OPENAI_API_KEY)=([^\r\n]+)/)
  if (m) key = m[1].trim()
}
if (!key) {
  console.error('NO_KEY_FOUND')
  process.exit(2)
}

;(async () => {
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: '안녕하세요. 이 키로 연결 확인 테스트합니다.' }], max_tokens: 50 }),
    })
    const text = await resp.text()
    console.log('STATUS', resp.status)
    console.log(text)
  } catch (err) {
    console.error('ERR', err?.message || err)
    process.exit(1)
  }
})()
