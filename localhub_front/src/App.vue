<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import restaurantsData from './data/대전_충청권_음식점.json'

const STORAGE_KEY = 'localhub-posts-v2'
const PASSWORD_KEY = 'localhub-passwords-v2'
const BOOKMARK_KEY = 'localhub-bookmarks-v1'
const MAP_KEY = import.meta.env.VITE_KAKAO_MAP_KEY || ''

const activeTab = ref('메인')
const searchKeyword = ref('')
const restaurantSearch = ref('')
const posts = ref([])
const selectedRestaurant = ref(null)
const isComposeOpen = ref(false)
const isChatOpen = ref(false)
const bookmarkedPostIds = ref([])
const form = ref({
  nickname: '',
  password: '',
  title: '',
  content: '',
  category: '자유주제',
  restaurantName: '',
})
const chatInput = ref('')
const skipTrivialOnce = ref(false)
const chatMessages = ref([
  {
    role: 'bot',
    text: '안녕하세요. 저는 대전 지역 음식점 데이터만 참조해 답변하는 챗봇입니다. 업소명/주소/우편번호/카테고리로 질문해주세요.',
  },
])

// Build follow-up options from local JSON when LLM fails to provide candidates
function buildFollowups(userQuery) {
  const lower = (userQuery || '').toLowerCase()

  // define larger groups and synonyms for naturalization
  const groups = [
    { key: '한식', label: '한식', syns: ['한식', '백반', '한정식', '한식당'] },
    { key: '양식/중식', label: '양식/중식', syns: ['양식', '파스타', '스테이크', '이탈리안', '중식', '짜장', '짬뽕'] },
    { key: '카페/디저트', label: '카페/디저트', syns: ['카페', '커피', '디저트', '베이커리'] },
    { key: '고기/구이', label: '고기/구이', syns: ['고기', '구이', '삼겹살', '갈비', '육류'] },
    { key: '국밥', label: '국밥', syns: ['국밥', '설렁탕', '곰탕'] },
    { key: '비빔밥', label: '비빔밥', syns: ['비빔밥'] },
    { key: '면', label: '면/국수', syns: ['면', '국수', '칼국수', '우동', '라면'] },
  ]

  const options = []

  // include groups that have matching restaurants
  for (const g of groups) {
    const exists = restaurantsData.items.some((r) => {
      const title = (r.title || '').toLowerCase()
      return g.syns.some((s) => title.includes(s))
    })
    if (exists) options.push({ label: `${g.label} 추천`, query: g.key })
  }

  // If user's query contains a synonym, prioritize that group
  for (const g of groups) {
    if (g.syns.some((s) => lower.includes(s))) {
      const idx = options.findIndex((o) => o.query === g.key)
      if (idx > 0) {
        const [it] = options.splice(idx, 1)
        options.unshift(it)
      }
      break
    }
  }

  return options
}
// searchResults is no longer used globally; candidates are rendered inline in chatMessages
const mapInstance = ref(null)
const mapReady = ref(false)
const restaurantList = ref(restaurantsData.items.slice(0, 40))

const tabOptions = [
  { value: '메인', label: '메인' },
  { value: '자유주제', label: '자유주제' },
  { value: '가게리뷰', label: '가게리뷰' },
  { value: '북마크', label: '북마크' },
]

const initializePosts = () => {
  if (typeof window === 'undefined') {
    posts.value = [
      {
        id: 1,
        nickname: '대전좋아',
        password: '',
        category: '자유주제',
        title: '주말에 가기 좋은 동네 추천',
        content: '산책하기 좋은 곳과 맛집이 같이 있는 동네를 찾고 있어요.',
        restaurantName: '',
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        nickname: '리뷰러',
        password: '',
        category: '가게리뷰',
        title: '이 집 음식 괜찮네요',
        content: '반찬이 정말 맛있고 재방문 의사 있습니다.',
        restaurantName: '대전 성심당 본점',
        createdAt: new Date().toISOString(),
      },
    ]
    return
  }

  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed) && parsed.length > 0) {
        posts.value = parsed
        return
      }
    } catch (error) {
      console.warn('저장된 데이터를 불러오지 못했습니다.', error)
    }
  }

  posts.value = [
    {
      id: 1,
      nickname: '대전좋아',
      password: '',
      category: '자유주제',
      title: '주말에 가기 좋은 동네 추천',
      content: '산책하기 좋은 곳과 맛집이 같이 있는 동네를 찾고 있어요.',
      restaurantName: '',
      createdAt: new Date().toISOString(),
    },
    {
      id: 2,
      nickname: '리뷰러',
      password: '',
      category: '가게리뷰',
      title: '이 집 음식 괜찮네요',
      content: '반찬이 정말 맛있고 재방문 의사 있습니다.',
      restaurantName: '대전 성심당 본점',
      createdAt: new Date().toISOString(),
    },
  ]
}

const initializeBookmarks = () => {
  if (typeof window === 'undefined') return
  const saved = localStorage.getItem(BOOKMARK_KEY)
  if (saved) {
    try {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        bookmarkedPostIds.value = parsed
      }
    } catch (error) {
      console.warn('북마크를 불러오지 못했습니다.', error)
    }
  }
}

onMounted(() => {
  initializePosts()
  initializeBookmarks()

  const savedPasswords = localStorage.getItem(PASSWORD_KEY)
  if (savedPasswords) {
    try {
      const parsed = JSON.parse(savedPasswords)
      if (parsed && typeof parsed === 'object') {
        posts.value = posts.value.map((post) => ({
          ...post,
          password: parsed[post.id] || post.password,
        }))
      }
    } catch (error) {
      console.warn('비밀번호를 불러오지 못했습니다.', error)
    }
  }

  if (typeof window !== 'undefined' && window.kakao?.maps) {
    initKakaoMap()
  } else if (typeof window !== 'undefined' && MAP_KEY) {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${MAP_KEY}&autoload=false`
    script.onload = () => {
      window.kakao.maps.load(initKakaoMap)
    }
    document.head.appendChild(script)
  }
})

watch(
  posts,
  (value) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    }
  },
  { deep: true },
)

watch(
  bookmarkedPostIds,
  (value) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(value))
    }
  },
  { deep: true },
)

const currentBoardTitle = computed(() => {
  if (activeTab.value === '자유주제') return '자유주제'
  if (activeTab.value === '가게리뷰') return '가게리뷰'
  return '북마크'
})

const visiblePosts = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()

  let base = posts.value.filter((post) => {
    if (activeTab.value === '자유주제') return post.category === '자유주제'
    if (activeTab.value === '가게리뷰') return post.category === '가게리뷰'
    if (activeTab.value === '북마크') return bookmarkedPostIds.value.includes(post.id)
    return false
  })

  if (!keyword) return base

  return base.filter((post) => {
    const haystack = [post.title, post.content, post.restaurantName, post.nickname]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(keyword)
  })
})

const filteredRestaurants = computed(() => {
  const keyword = restaurantSearch.value.trim().toLowerCase()
  if (!keyword) return restaurantList.value
  return restaurantList.value.filter((item) => {
    const haystack = [item.title, item.addr1].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(keyword)
  })
})

const selectedRestaurantReviews = computed(() => {
  if (!selectedRestaurant.value) return []
  return posts.value.filter((post) => {
    return post.category === '가게리뷰' && post.restaurantName === selectedRestaurant.value.title
  })
})

const resetForm = () => {
  form.value = {
    nickname: '',
    password: '',
    title: '',
    content: '',
    category: activeTab.value === '가게리뷰' ? '가게리뷰' : '자유주제',
    restaurantName: selectedRestaurant.value?.title || '',
  }
}

const openCompose = () => {
  resetForm()
  isComposeOpen.value = true
}

const handleSubmit = () => {
  if (!form.value.nickname || !form.value.title || !form.value.content) return

  const newPost = {
    id: Date.now(),
    nickname: form.value.nickname,
    password: form.value.password || '',
    category: form.value.category,
    title: form.value.title,
    content: form.value.content,
    restaurantName: form.value.restaurantName || '',
    createdAt: new Date().toISOString(),
  }

  posts.value = [newPost, ...posts.value]

  if (form.value.password) {
    const existing = JSON.parse(localStorage.getItem(PASSWORD_KEY) || '{}')
    existing[newPost.id] = form.value.password
    localStorage.setItem(PASSWORD_KEY, JSON.stringify(existing))
  }

  isComposeOpen.value = false
  resetForm()
}

const selectRestaurant = (restaurant) => {
  selectedRestaurant.value = restaurant
  if (mapInstance.value && window.kakao?.maps) {
    const lat = Number(restaurant.mapy)
    const lng = Number(restaurant.mapx)
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      const moveLatLon = new window.kakao.maps.LatLng(lat, lng)
      mapInstance.value.setCenter(moveLatLon)
      mapInstance.value.setLevel(4)
    }
  }
}

const initKakaoMap = () => {
  if (!window.kakao?.maps || !document.getElementById('kakao-map')) return

  const container = document.getElementById('kakao-map')
  const options = {
    center: new window.kakao.maps.LatLng(36.35, 127.38),
    level: 10,
  }
  mapInstance.value = new window.kakao.maps.Map(container, options)
  mapReady.value = true

  restaurantList.value.forEach((restaurant) => {
    const lat = Number(restaurant.mapy)
    const lng = Number(restaurant.mapx)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return

    const marker = new window.kakao.maps.Marker({
      position: new window.kakao.maps.LatLng(lat, lng),
      map: mapInstance.value,
    })

    const infoWindow = new window.kakao.maps.InfoWindow({
      content: `<div style="padding:6px 10px;font-size:13px;">${restaurant.title}</div>`,
    })

    window.kakao.maps.event.addListener(marker, 'click', () => {
      selectRestaurant(restaurant)
      infoWindow.open(mapInstance.value, marker)
    })
  })
}

const toggleBookmark = (postId) => {
  if (bookmarkedPostIds.value.includes(postId)) {
    bookmarkedPostIds.value = bookmarkedPostIds.value.filter((id) => id !== postId)
  } else {
    bookmarkedPostIds.value = [...bookmarkedPostIds.value, postId]
  }
}

const sendChatMessage = async () => {
  const text = chatInput.value.trim()
  if (!text) return

  chatMessages.value.push({ role: 'user', text })
  chatInput.value = ''

  try {
    const resp = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
    const json = await resp.json()
    let reply = json?.reply || '죄송합니다. 대전 지역 음식점 관련 질문을 해주세요.'
    // 특정 내부 폴백 안내 문구는 사용자에게 노출하지 않음
    if (reply && reply.includes('모델 접근 권한')) {
      reply = '요청하신 기준으로 몇 곳 추천드릴게요.'
    }

    // If server gives a generic '요청하신 기준으로 몇 곳 추천드릴게요.', do NOT display it.
    // - If candidates exist, we'll render them below without showing this generic text.
    // - If no candidates, show a category selection prompt instead.
    const NEED_CATEGORY_MSG = '요청하신 기준으로 몇 곳 추천드릴게요.'
    if (reply === NEED_CATEGORY_MSG) {
      if (!json?.candidates || json.candidates.length === 0) {
        const followups = buildFollowups(text)
        chatMessages.value.push({ role: 'bot', text: '카테고리를 선택해 주세요. 아래에서 골라주세요.', followups })
      }
      // otherwise: skip pushing the generic reply entirely
    } else {
      if (reply) chatMessages.value.push({ role: 'bot', text: reply })
    }

    // Trivial input detection (greetings, very short non-intent)
    const isTrivialQuery = (s) => {
      if (!s) return true
      const low = s.toLowerCase()
      const greetings = ['안녕', '안녕하세요', '하이', 'hi', 'hello', '반가워', '반갑']
      if (greetings.some((g) => low.includes(g))) return true
      // very short queries (1-2 characters) likely non-intent
      if (low.replace(/\s+/g, '').length <= 2) return true
      return false
    }

    // candidates가 있으면 그것을 enrich(이미지 조회 등)한 후 채팅 메시지로 추가
    let candidates = json?.candidates || []
    const trivial = isTrivialQuery(text) && !skipTrivialOnce.value
    // reset the skip flag after using it
    if (skipTrivialOnce.value) skipTrivialOnce.value = false
    const kakaoKey = import.meta.env.VITE_KAKAO_REST_KEY || ''
    if (candidates.length) {
      for (const item of candidates) {
        if (!item.firstimage && item.title) {
          try {
            // 1) try kakao if key provided
            let gotImage = false
            if (kakaoKey) {
              try {
                const q = encodeURIComponent(item.title + ' ' + (item.addr1 || ''))
                const r = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${q}`, {
                  headers: { Authorization: `KakaoAK ${kakaoKey}` },
                })
                if (r.ok) {
                  const d = await r.json()
                  const place = d?.documents?.[0]
                  if (place && place.place_name) {
                    item.firstimage = place?.place_url || item.firstimage || ''
                    item.place_url = place?.place_url || item.place_url || ''
                    item.mapx = item.mapx || place?.x || item.mapx
                    item.mapy = item.mapy || place?.y || item.mapy
                    gotImage = !!item.firstimage
                  }
                }
              } catch (er) {
                console.warn('Kakao image fetch failed', er)
              }
            }
            // 2) if still no image, fallback to Unsplash (guarantees an image)
            if (!item.firstimage) {
              const imgUrl = `https://source.unsplash.com/featured/?${encodeURIComponent(item.title + ' restaurant')}`
              item.firstimage = imgUrl
            }
            
          } catch (er) {
            console.warn('Kakao image fetch failed', er)
          }
        }
      }
    }

    if (trivial) {
      // For trivial inputs, prioritize showing follow-up options instead of candidates
      const followups = buildFollowups(text)
      chatMessages.value.push({ role: 'bot', followups })
    } else {
      if (candidates.length) {
        chatMessages.value.push({ role: 'bot', candidates })
      } else {
        // no candidates -> provide follow-up options derived from local JSON
        const followups = buildFollowups(text)
        chatMessages.value.push({ role: 'bot', text: reply, followups })
      }
    }
  } catch (err) {
    console.error(err)
    chatMessages.value.push({ role: 'bot', text: '서버에 연결할 수 없습니다.' })
  }
}

function handleFollowupClick(query) {
  // set the query and force one search even if query looks trivial
  skipTrivialOnce.value = true
  chatInput.value = query
  // small delay to allow UI update then send
  setTimeout(() => sendChatMessage(), 50)
}

function makeKakaoLink(item) {
  const lat = item.mapy || ''
  const lng = item.mapx || ''
  const title = item.title || ''
  if (lat && lng) return `https://map.kakao.com/link/map/${encodeURIComponent(title)},${lat},${lng}`
  return '#'
}

function onCandidateWheel(e) {
  // Convert vertical wheel to horizontal scroll for candidate rows
  try {
    e.preventDefault()
    const row = e.currentTarget
    const children = row.querySelectorAll('.candidate-card')
    if (!children || children.length === 0) return
    const card = children[0]
    const gap = parseFloat(getComputedStyle(row).gap) || 12
    const step = Math.round(card.getBoundingClientRect().width + gap)
    // current index
    let index = Math.round(row.scrollLeft / step)
    if (e.deltaY > 0) index = Math.min(index + 1, children.length - 1)
    else index = Math.max(index - 1, 0)
    row.scrollTo({ left: index * step, behavior: 'smooth' })
  } catch (err) {
    // ignore
  }
}

function onImgError(e, title) {
  try {
    e.target.onerror = null
    e.target.src = `https://source.unsplash.com/featured/?${encodeURIComponent(title + ' restaurant')}`
  } catch (err) {
    // ignore
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="hero">
      <div class="hero-left">
        <div class="brand">LocalHub</div>
        <nav class="nav-menu">
          <button
            v-for="tab in tabOptions"
            :key="tab.value"
            type="button"
            class="nav-item"
            :class="{ active: activeTab === tab.value }"
            @click="activeTab = tab.value"
          >
            {{ tab.label }}
          </button>
        </nav>
      </div>

      <div class="hero-badges">
        <div class="badge-box">
          <strong>총 게시글</strong>
          <span>{{ posts.length }}</span>
        </div>
      </div>
    </header>

    <section v-if="activeTab === '메인'" class="main-view">
      <div class="map-card">
        <div class="card-title-row">
          <h2>식당 지도</h2>
          <div class="search-row">
            <input v-model="restaurantSearch" placeholder="식당 이름 또는 주소 검색" />
            <button type="button" class="secondary" @click="restaurantSearch = ''">초기화</button>
          </div>
        </div>

        <div id="kakao-map" class="kakao-map"></div>
        <div v-if="!mapReady && MAP_KEY" class="map-loading">지도를 불러오는 중입니다...</div>
        <div v-else-if="!MAP_KEY" class="map-loading">카카오맵 키를 설정하면 실제 지도가 표시됩니다.</div>

        <div v-if="filteredRestaurants.length" class="restaurant-list">
          <button
            v-for="restaurant in filteredRestaurants"
            :key="restaurant.title"
            type="button"
            class="restaurant-item"
            @click="selectRestaurant(restaurant)"
          >
            {{ restaurant.title }}
          </button>
        </div>
      </div>

      <div class="review-card">
        <h2>선택한 가게 리뷰</h2>
        <div v-if="selectedRestaurant" class="selected-store">
          <strong>{{ selectedRestaurant.title }}</strong>
          <p>{{ selectedRestaurant.addr1 }}</p>
        </div>
        <div v-else class="empty-state">지도에서 가게를 선택하면 리뷰가 나타납니다.</div>

        <div v-for="review in selectedRestaurantReviews" :key="review.id" class="review-item">
          <div class="review-header">
            <strong>{{ review.title }}</strong>
            <span>{{ review.nickname }}</span>
          </div>
          <p>{{ review.content }}</p>
        </div>
      </div>
    </section>

    <section v-else class="board-view">
      <div class="board-header">
        <div>
          <h2>{{ currentBoardTitle }}</h2>
          <p class="sub-copy">
            {{ activeTab === '자유주제' ? '자유롭게 이야기하는 공간입니다.' : activeTab === '가게리뷰' ? '가게 후기를 남기는 공간입니다.' : '북마크한 글만 모아봅니다.' }}
          </p>
        </div>

        <div class="board-tools">
          <input v-model="searchKeyword" :placeholder="`${currentBoardTitle} 검색`" />
          <button type="button" class="primary" @click="openCompose">글쓰기</button>
        </div>
      </div>

      <div class="post-list">
        <article v-for="post in visiblePosts" :key="post.id" class="post-card">
          <div class="post-meta">
            <span class="pill">{{ post.category }}</span>
            <span>{{ post.nickname }}</span>
          </div>
          <h3>{{ post.title }}</h3>
          <p>{{ post.content }}</p>
          <div v-if="post.restaurantName" class="restaurant-link">{{ post.restaurantName }}</div>

          <button type="button" class="bookmark-btn" @click="toggleBookmark(post.id)">
            {{ bookmarkedPostIds.includes(post.id) ? '★' : '☆' }}
          </button>
        </article>
      </div>
    </section>

    <button v-if="activeTab !== '메인'" type="button" class="floating-write" @click="openCompose">✎</button>

    <div v-if="isComposeOpen" class="modal-backdrop" @click.self="isComposeOpen = false">
      <div class="modal-card">
        <div class="modal-header">
          <h3>게시글 작성</h3>
          <button type="button" class="secondary" @click="isComposeOpen = false">닫기</button>
        </div>

        <form @submit.prevent="handleSubmit">
          <div class="form-grid">
            <input v-model="form.nickname" required placeholder="닉네임" />
            <input v-model="form.password" placeholder="비밀번호(선택)" />
            <select v-model="form.category">
              <option value="자유주제">자유주제</option>
              <option value="가게리뷰">가게리뷰</option>
            </select>
            <input v-model="form.title" required placeholder="제목" />
          </div>

          <textarea v-model="form.content" required placeholder="내용을 입력하세요"></textarea>
          <input v-model="form.restaurantName" placeholder="가게 이름(가게리뷰일 때 입력 가능)" />

          <div class="modal-actions">
            <button type="submit" class="primary">등록</button>
          </div>
        </form>
      </div>
    </div>

    <button type="button" class="chat-toggle" @click="isChatOpen = !isChatOpen">
      {{ isChatOpen ? '×' : '💬' }}
    </button>

    <div v-if="isChatOpen" class="chat-float">
      <div class="chat-header">
        <strong>챗봇</strong>
        <button type="button" class="chat-close" @click="isChatOpen = false">×</button>
      </div>

      <div class="chat-log">
        <div v-for="(message, index) in chatMessages" :key="index" class="message" :class="message.role">
          <strong>{{ message.role === 'user' ? '나' : '챗봇' }}</strong>
          <p v-if="message.text">{{ message.text }}</p>

          <!-- candidates가 있는 bot 메시지는 카드형 가로 스크롤로 표시 -->
              <div v-if="message.candidates && message.candidates.length" class="candidate-row" @wheel="onCandidateWheel">
            <div v-for="(r, i) in message.candidates" :key="i" class="candidate-card">
              <a :href="r.place_url || makeKakaoLink(r)" target="_blank" rel="noopener noreferrer">
                <div class="thumb-small">
                  <img v-if="r.firstimage" :src="r.firstimage" alt="img" loading="lazy" @error="onImgError($event, r.title)" />
                  <div v-else class="noimg">이미지 없음</div>
                </div>
              </a>
              <div class="meta-small">
                <strong class="title"><a :href="r.place_url || makeKakaoLink(r)" target="_blank" rel="noopener noreferrer">{{ r.title }}</a></strong>
                <div class="addr">{{ r.addr1 }} {{ r.addr2 || '' }}</div>
              </div>
            </div>
          </div>
          <!-- follow-up options when LLM couldn't return candidates -->
          <div v-if="message.followups && message.followups.length" class="followup-row">
            <button v-for="(f, fi) in message.followups" :key="fi" type="button" class="followup-btn" @click="handleFollowupClick(f.query)">{{ f.label }}</button>
          </div>
        </div>
      </div>

      <div class="chat-input-row">
        <input v-model="chatInput" @keyup.enter="sendChatMessage" placeholder="질문을 입력하세요" />
        <button type="button" @click="sendChatMessage">전송</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background: #f4f7fb;
  font-family: 'Pretendard', 'Segoe UI', sans-serif;
}

.app-shell {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
  color: #1f2937;
}

.hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 20px 24px;
  border-radius: 24px;
  background: linear-gradient(135deg, #eff6ff, #fef3c7);
  margin-bottom: 20px;
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 18px;
}

.brand {
  font-size: 28px;
  font-weight: 800;
  color: #111827;
}

.nav-menu {
  display: flex;
  gap: 8px;
  align-items: center;
}

.nav-item {
  background: transparent;
  color: #6b7280;
  border: none;
  padding: 8px 10px;
  border-radius: 999px;
  font-weight: 600;
  transition: all 0.2s ease;
}

.nav-item:hover {
  color: #111827;
  background: #f3f4f6;
}

.nav-item.active {
  color: white;
  background: #111827;
}

.hero-badges {
  display: flex;
  gap: 12px;
}

.badge-box {
  min-width: 120px;
  padding: 12px 14px;
  border-radius: 14px;
  background: white;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.06);
}

.badge-box strong {
  display: block;
  font-size: 11px;
  color: #6b7280;
}

.badge-box span {
  font-size: 16px;
  font-weight: 700;
}

.main-view {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

.map-card,
.review-card,
.board-view,
.modal-card,
.chat-float {
  background: white;
  border-radius: 20px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

.map-card,
.review-card {
  padding: 16px;
}

.card-title-row,
.modal-header,
.chat-header,
.board-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.board-header {
  align-items: flex-start;
}

.sub-copy {
  margin: 6px 0 0;
  color: #6b7280;
}

.search-row,
.board-tools {
  display: flex;
  gap: 8px;
  align-items: center;
}

  .search-row input,
  .board-tools input,
  .modal-card input,
  .modal-card textarea,
  .modal-card select,
  .chat-input-row input {
    width: 100%;
    border: 1px solid #d1d5db;
    border-radius: 10px;
    padding: 10px 12px;
    box-sizing: border-box;
    flex: 1;
  }

.kakao-map {
  width: 100%;
  height: 360px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
}

.map-loading {
  margin-top: 10px;
  color: #6b7280;
}

.restaurant-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.restaurant-item {
  background: #f3f4f6;
  color: #374151;
  border-radius: 999px;
  padding: 8px 12px;
}

.review-item {
  padding: 10px 0;
  border-bottom: 1px solid #e5e7eb;
}

.review-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.selected-store {
  margin-bottom: 12px;
  padding: 10px;
  border-radius: 12px;
  background: #f8fafc;
}

.board-view {
  padding: 16px;
}

.post-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
}

.post-card {
  padding: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  position: relative;
}

.post-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  color: #6b7280;
  font-size: 13px;
  margin-bottom: 8px;
}

.pill {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 999px;
  background: #e0f2fe;
  color: #0369a1;
}

.restaurant-link {
  margin-top: 8px;
  color: #2563eb;
  font-weight: 600;
}

.bookmark-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  border: none;
  background: transparent;
  font-size: 18px;
  color: #f59e0b;
  cursor: pointer;
}

.floating-write {
  position: fixed;
  right: 24px;
  bottom: 92px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: #2563eb;
  color: white;
  font-size: 24px;
  cursor: pointer;
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.3);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 100;
}

.modal-card {
  width: min(560px, 100%);
  padding: 18px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.modal-card textarea {
  min-height: 110px;
  margin-top: 10px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

button {
  border: none;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  font-weight: 600;
}

button.primary {
  background: #2563eb;
  color: white;
}

button.secondary {
  background: #e5e7eb;
  color: #374151;
}

.chat-toggle {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: none;
  background: #111827;
  color: white;
  font-size: 22px;
  cursor: pointer;
  box-shadow: 0 10px 20px rgba(17, 24, 39, 0.25);
  z-index: 90;
}

.chat-float {
  position: fixed;
  right: 20px;
  bottom: 86px;
  width: min(360px, calc(100vw - 32px));
  padding: 14px;
  z-index: 80;
  background: white;
  border-radius: 16px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
}

.chat-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  overflow-y: auto;
  margin-bottom: 10px;
}

.search-results {
  margin-top: 10px;
}
.candidate-row { display:flex; gap:12px; overflow-x:auto; padding:8px 0; scroll-behavior: smooth; scroll-snap-type: x mandatory }
.candidate-card { min-width:240px; flex:0 0 auto; display:flex; gap:8px; padding:8px; border:1px solid #eee; border-radius:8px; align-items:center; background:#fff; scroll-snap-align: start }
.candidate-card .thumb-small { width:96px; height:72px; background:#f3f4f6; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:6px }
.candidate-card .thumb-small img { width:100%; height:100%; object-fit:cover }
.candidate-card .noimg { color:#6b7280; font-size:12px }
.candidate-card .meta-small { flex:1 }
.candidate-card .addr, .candidate-card .cat { font-size:12px; color:#6b7280 }
.candidate-card .title { font-size:14px; display:block; margin-bottom:4px }

/* Slim scrollbar for candidate row and chat log */
.candidate-row::-webkit-scrollbar { height:8px }
.candidate-row::-webkit-scrollbar-track { background: transparent }
.candidate-row::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.18); border-radius: 8px }
.chat-log::-webkit-scrollbar { width:8px }
.chat-log::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 8px }
.chat-float { max-height: 70vh }

.message {
  padding: 10px 12px;
  border-radius: 12px;
  background: #f8fafc;
}

.message.bot {
  background: #eff6ff;
}

.message strong {
  display: block;
  margin-bottom: 4px;
}

.chat-input-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.chat-input-row input:focus {
  outline: none;
  border-color: #000;
  box-shadow: 0 0 0 2px rgba(0,0,0,0.06);
}

.chat-close {
  background: transparent;
  padding: 0;
  font-size: 18px;
  color: #666;
}

.empty-state {
  color: #6b7280;
  padding: 10px 0;
}

@media (max-width: 900px) {
  .main-view {
    grid-template-columns: 1fr;
  }

  .hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .hero-left {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .board-header,
  .card-title-row {
    flex-direction: column;
    align-items: stretch;
  }

  .board-tools,
  .search-row {
    flex-direction: column;
    align-items: stretch;
  }

  .hero-badges {
    width: 100%;
  }

  .badge-box {
    flex: 1;
  }
}
</style>