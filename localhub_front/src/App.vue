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
const chatMessages = ref([
  {
    role: 'bot',
    text: '안녕하세요! 지역 커뮤니티 챗봇입니다. 지도에서 식당을 클릭하거나 게시글 카테고리를 바꿔보세요.',
  },
])
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

const sendChatMessage = () => {
  const text = chatInput.value.trim()
  if (!text) return

  chatMessages.value.push({ role: 'user', text })
  const lower = text.toLowerCase()

  let reply = '원하는 카테고리와 식당을 선택하면 더 정확하게 도와드릴게요.'
  if (lower.includes('자유') || lower.includes('게시판')) {
    reply = '자유주제 탭에서는 일상, 동네 정보, 추천을 남길 수 있어요.'
  } else if (lower.includes('리뷰') || lower.includes('식당')) {
    reply = '가게리뷰 탭에서는 특정 식당에 대한 후기를 남기고 확인할 수 있어요.'
  } else if (lower.includes('검색')) {
    reply = '지도 상단 검색창으로 식당 이름을 먼저 찾아보세요.'
  }

  chatMessages.value.push({ role: 'bot', text: reply })
  chatInput.value = ''
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
          <p>{{ message.text }}</p>
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
  max-height: 220px;
  overflow-y: auto;
  margin-bottom: 10px;
}

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