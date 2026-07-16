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
  const models = ['gpt-5-mini', 'gpt-4o-mini', 'gpt-4', 'gpt-3.5-turbo']
  for (const model of models) {
    try {
      console.log('Trying model', model)
      let payload = { model, messages: [{ role: 'user', content: '안녕하세요. 이 키로 연결 확인 테스트합니다.' }], max_tokens: 50 }
      let resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
      })
      let text = await resp.text()
      // retry for models that don't accept max_tokens
      if (!resp.ok && typeof text === 'string' && (text.includes('max_tokens') && text.includes('not supported') || text.includes('Unsupported parameter') && text.includes('max_tokens'))) {
        try {
          payload = { model, messages: [{ role: 'user', content: '안녕하세요. 이 키로 연결 확인 테스트합니다.' }] }
          payload.max_completion_tokens = 50
          resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(payload),
          })
          text = await resp.text()
        } catch (e) {
          console.error('Retry error', e?.message || e)
        }
      }

      console.log('STATUS', resp.status)
      console.log(text)
      if (resp.ok) break
    } catch (err) {
      console.error('ERR', err?.message || err)
    }
  }
})()
