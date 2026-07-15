<script setup>
import { computed, onMounted, ref, watch, nextTick } from 'vue'
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
const searchInputRef = ref(null)

const isEditMode = ref(false)
const editingPostId = ref(null)

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

// 수정: 메인이 아닐 때 각 탭(자유주제, 가게리뷰, 북마크)의 글 개수 계산
const currentBoardPostCount = computed(() => {
  return visiblePosts.value.length
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

const focusSearch = () => {
  nextTick(() => {
    if (searchInputRef.value) {
      searchInputRef.value.focus()
    }
  })
}

const deletePost = (postId) => {
  const targetPost = posts.value.find((p) => p.id === postId)
  if (!targetPost) return

  const savedPasswords = JSON.parse(localStorage.getItem(PASSWORD_KEY) || '{}')
  const actualPassword = savedPasswords[postId] || targetPost.password

  if (!actualPassword) {
    if (confirm('비밀번호가 설정되지 않은 게시글입니다. 삭제하시겠습니까?')) {
      posts.value = posts.value.filter((p) => p.id !== postId)
    }
    return
  }

  const inputPassword = prompt('게시글을 삭제하려면 비밀번호를 입력하세요.')
  if (inputPassword === null) return

  if (inputPassword === actualPassword) {
    posts.value = posts.value.filter((p) => p.id !== postId)
    delete savedPasswords[postId]
    localStorage.setItem(PASSWORD_KEY, JSON.stringify(savedPasswords))
    alert('삭제되었습니다.')
  } else {
    alert('비밀번호가 일치하지 않습니다.')
  }
}


// 1. 비밀번호 검증 (prompt 대신 모달 UI를 사용해야 하지만, 
// 현재 환경이 prompt를 막고 있다면 아래 로직도 작동하지 않습니다. 
// 이 경우 prompt를 input 폼으로 대체해야 합니다.)
const checkPermission = (postId) => {
  const targetPost = posts.value.find((p) => p.id === postId);
  if (!targetPost) return { result: false, type: 'notfound' };

  const savedPasswords = JSON.parse(localStorage.getItem(PASSWORD_KEY) || '{}');
  const actualPassword = savedPasswords[postId] || targetPost.password;

  if (!actualPassword) {
    return { result: confirm('비밀번호가 없는 글입니다. 진행하시겠습니까?'), type: 'no-password' };
  }

  // 만약 여기서 에러(prompt not supported)가 난다면, 
  // 아래 prompt를 제거하고 모달창을 띄우는 방식으로 변경해야 합니다.
  const inputPassword = prompt('비밀번호를 입력하세요.');
  if (inputPassword === null) return { result: false, type: 'cancel' };
  
  return inputPassword === actualPassword 
    ? { result: true, type: 'success' } 
    : { result: false, type: 'wrong-password' };
};

// 2. 수정 함수 (postId 사용)
const openEdit = (postId) => {
  const post = posts.value.find((p) => p.id === postId);
  if (!post) {
    console.error("게시글을 찾을 수 없습니다:", postId);
    return;
  }

  const status = checkPermission(postId);
  
  if (status.result) {
    isEditMode.value = true;
    editingPostId.value = postId;
    
    // form에 데이터 복사
    form.value = { ...post }; 
    
    isComposeOpen.value = true;
  } else if (status.type === 'wrong-password') {
    alert('비밀번호가 일치하지 않습니다.');
  }
};

const handleSubmit = () => {
if (isEditMode.value) {
    // 1. 수정할 포스트 찾기
    const index = posts.value.findIndex(p => p.id === editingPostId.value);
    if (index !== -1) {
      // 2. 새로운 객체로 대체하여 반응성 유지
      posts.value[index] = {
        ...posts.value[index],
        title: form.value.title,
        content: form.value.content,
        category: form.value.category,
        restaurantName: form.value.restaurantName
      };

      // 3. 로컬 스토리지 업데이트
      localStorage.setItem(STORAGE_KEY, JSON.stringify(posts.value));
    }

    // 4. 상태 초기화
    isEditMode.value = false;
    editingPostId.value = null;
    isComposeOpen.value = false;
    resetForm();

  return
}
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

  // 기존 배열 앞에 새 글 추가 후 반응성 갱신
  posts.value = [newPost, ...posts.value]

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(posts.value))
    if (form.value.password) {
      const existing = JSON.parse(localStorage.getItem(PASSWORD_KEY) || '{}')
      existing[newPost.id] = form.value.password
      localStorage.setItem(PASSWORD_KEY, JSON.stringify(existing))
    }
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

      <div v-if="activeTab !== '메인'" class="hero-badges">
        <div class="badge-box">
          <strong>{{ activeTab === '북마크' ? '북마크 개수' : `${currentBoardTitle} 게시글` }}</strong>
          <span>{{ currentBoardPostCount }}</span>
        </div>
      </div>
    </header>

    <section v-if="activeTab === '메인'" class="main-view">
      <div class="map-card">
        <div class="card-title-row">
          <h2>식당 지도</h2>
          <div class="search-row">
            <input v-model="restaurantSearch" placeholder="식당 이름 또는 주소 검색" />
            <button type="button" class="primary search-btn">🔍</button>
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
          <button type="button" class="delete-btn" @click="deletePost(review.id)">삭제</button>
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
          <input ref="searchInputRef" v-model="searchKeyword" :placeholder="`${currentBoardTitle} 검색`" />
          <button type="button" class="primary" @click="focusSearch">🔍</button>
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

          <div class="post-actions">
            <div style="display: flex; gap: 8px;">
            <button @click="openEdit(post.id)" style="width: 60px; height: 30px; display: flex; align-items: center; justify-content: center;">수정</button>
            <button @click="deletePost(post.id)" style="width: 60px; height: 30px; display: flex; align-items: center; justify-content: center;">삭제</button>
            </div>
            <button type="button" class="bookmark-btn" @click="toggleBookmark(post.id)">
              {{ bookmarkedPostIds.includes(post.id) ? '★' : '☆' }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <button v-if="activeTab !== '메인' && activeTab !== '북마크'" type="button" class="floating-write" @click="openCompose">✎</button>

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
          <input v-if="form.category === '가게리뷰'" v-model="form.restaurantName" placeholder="가게 이름" />
          <div class="modal-actions">
            <button type="submit" class="primary">{{ isEditMode ? '수정' : '등록' }}</button>
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
/* 토스 UI 느낌으로 부드러운 여백, 모서리(Radius), 그림자 다듬기 */
:global(body) {
  margin: 0;
  background: #f4f6f8;
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
}

.app-shell {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
  color: #191f28;
}

.hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding: 20px 28px;
  border-radius: 24px;
  background: white;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
  margin-bottom: 24px;
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.brand {
  font-size: 26px;
  font-weight: 800;
  color: #3182f6;
}

.nav-menu {
  display: flex;
  gap: 6px;
  align-items: center;
}

.nav-item {
  background: transparent;
  color: #6b7684;
  border: none;
  padding: 10px 16px;
  border-radius: 14px;
  font-weight: 600;
  font-size: 15px;
  transition: all 0.2s ease;
}

.nav-item:hover {
  color: #191f28;
  background: #f2f4f6;
}

.nav-item.active {
  color: white;
  background: #3182f6;
}

.hero-badges {
  display: flex;
  gap: 12px;
}

.badge-box {
  min-width: 110px;
  padding: 12px 16px;
  border-radius: 16px;
  background: #f9fbfd;
  border: 1px solid #e5e8eb;
}

.badge-box strong {
  display: block;
  font-size: 12px;
  color: #6b7684;
  margin-bottom: 4px;
}

.badge-box span {
  font-size: 18px;
  font-weight: 700;
  color: #3182f6;
}

.main-view {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 24px;
  margin-bottom: 24px;
}

.map-card,
.review-card,
.board-view,
.modal-card,
.chat-float {
  background: white;
  border-radius: 24px;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.02);
}

.map-card,
.review-card {
  padding: 24px;
}

.card-title-row,
.modal-header,
.chat-header,
.board-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.board-header {
  align-items: flex-start;
}

.sub-copy {
  margin: 6px 0 0;
  color: #6b7684;
  font-size: 14px;
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
  border: 1px solid #e5e8eb;
  border-radius: 14px;
  padding: 12px 16px;
  box-sizing: border-box;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
}

.search-row input:focus,
.board-tools input:focus,
.modal-card input:focus,
.modal-card textarea:focus {
  border-color: #3182f6;
}

.kakao-map {
  width: 100%;
  height: 380px;
  border-radius: 18px;
  background: #f2f4f6;
  border: none;
}

.map-loading {
  margin-top: 10px;
  color: #6b7684;
}

.restaurant-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.restaurant-item {
  background: #f2f4f6;
  color: #333d4b;
  border-radius: 12px;
  padding: 8px 14px;
  font-size: 13px;
  transition: background 0.2s;
}

.restaurant-item:hover {
  background: #e5e8eb;
}

.review-item {
  padding: 14px 0;
  border-bottom: 1px solid #f2f4f6;
  position: relative;
}

.review-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.selected-store {
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 16px;
  background: #f9fbfd;
  border: 1px solid #e5e8eb;
}

.board-view {
  padding: 24px;
}

.post-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.post-card {
  padding: 20px;
  border: 1px solid #e5e8eb;
  border-radius: 20px;
  position: relative;
  transition: transform 0.2s, box-shadow 0.2s;
}

.post-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.04);
}

.post-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  color: #6b7684;
  font-size: 13px;
  margin-bottom: 10px;
}

.pill {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 8px;
  background: #e8f3ff;
  color: #1b64da;
  font-weight: 600;
  font-size: 12px;
}

.restaurant-link {
  margin-top: 10px;
  color: #3182f6;
  font-weight: 600;
  font-size: 14px;
}

.post-actions {
  position: absolute;
  top: 18px;
  right: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.delete-btn {
  background: #f2f4f6;
  color: #f04452;
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 8px;
  font-weight: 600;
}

.delete-btn:hover {
  background: #feebee;
}

.bookmark-btn {
  border: none;
  background: transparent;
  font-size: 20px;
  color: #ffc107;
  cursor: pointer;
  padding: 0;
}

.floating-write {
  position: fixed;
  right: 28px;
  bottom: 96px;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: none;
  background: #3182f6;
  color: white;
  font-size: 26px;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(49, 130, 246, 0.3);
  transition: transform 0.2s;
}

.floating-write:hover {
  transform: scale(1.05);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 100;
}

.modal-card {
  width: min(560px, 100%);
  padding: 24px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.modal-card textarea {
  min-height: 130px;
  margin-top: 12px;
  resize: vertical;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

button {
  border: none;
  border-radius: 12px;
  padding: 10px 16px;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  transition: background 0.2s;
}

button.primary {
  background: #3182f6;
  color: white;
}

button.primary:hover {
  background: #1b64da;
}

button.secondary {
  background: #f2f4f6;
  color: #4e5968;
}

button.secondary:hover {
  background: #e5e8eb;
}

.chat-toggle {
  position: fixed;
  right: 28px;
  bottom: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: #191f28;
  color: white;
  font-size: 22px;
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
  z-index: 90;
}

.chat-float {
  position: fixed;
  right: 28px;
  bottom: 90px;
  width: min(360px, calc(100vw - 32px));
  padding: 20px;
  z-index: 80;
  background: white;
  border-radius: 24px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.chat-log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 240px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.message {
  padding: 12px 14px;
  border-radius: 16px;
  background: #f2f4f6;
  font-size: 14px;
}

.message.bot {
  background: #e8f3ff;
  color: #1b64da;
}

.message strong {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
}

.chat-input-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.chat-close {
  background: transparent;
  padding: 0;
  font-size: 20px;
  color: #8b95a1;
}

.empty-state {
  color: #8b95a1;
  padding: 20px 0;
  text-align: center;
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