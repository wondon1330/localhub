<script setup>
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
const selectPopularRestaurant = (restaurant) => {
  // 오른쪽 선택한 가게 정보 변경
  selectRestaurant(restaurant)

  // 지도 이동
  if (mapInstance.value) {
    const lat = Number(restaurant.mapy)
    const lng = Number(restaurant.mapx)

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      mapInstance.value.setView([lat, lng], 15)
    }
  }
}
// fix Leaflet default icon paths for Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
})
import restaurantsData from './data/대전_충청권_음식점.json'

const STORAGE_KEY = 'localhub-posts-v2'
const PASSWORD_KEY = 'localhub-passwords-v2'
const BOOKMARK_KEY = 'localhub-bookmarks-v1'
const MAP_KEY = import.meta.env.VITE_KAKAO_MAP_KEY || ''
const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY || ''

const activeTab = ref('메인')
const searchKeyword = ref('')
const restaurantSearch = ref('')
const blogQuery = ref('')
const blogResults = ref([])
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
  rating: 5,
})

const restaurantSuggestions = computed(() => {
  const keyword = form.value.restaurantName.trim()
  if (!keyword) return []
  return restaurantList.value
    .filter(r => (r.title || '').includes(keyword))
    .map(r => r.title)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 5)
})
const chatInput = ref('')
const skipTrivialOnce = ref(false)
const chatMessages = ref([
  {
    role: 'bot',
    text: '안녕하세요. 저는 대전 지역 음식점 데이터만 참조해 답변하는 챗봇입니다. 업소명/주소/우편번호/카테고리로 질문해주세요.',
  },
])
const chatLogRef = ref(null)
const isProcessing = ref(false)
// Backend removed per 의뢰서: front-end will call OpenAI directly using `VITE_OPENAI_API_KEY`.

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

// Lightweight client-side retrieval fallback (used when LLM unavailable)
function retrieve(query, limit = 6) {
  const q = (query || '').toLowerCase().trim()
  if (!q) return []

  // strict title/address match first
  const direct = restaurantsData.items.filter((it) => {
    const hay = [it.title, it.addr1, it.zipcode, it.tel].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
  if (direct.length) return direct.slice(0, limit)

  // category heuristics
  if (q.includes('한식')) return restaurantsData.items.filter((it) => (it.lclsSystm2 || '').includes('FD01')).slice(0, limit)
  if (q.includes('카페') || q.includes('커피')) return restaurantsData.items.filter((it) => (it.lclsSystm2 || '').includes('FD05')).slice(0, limit)
  if (q.includes('베이커리') || q.includes('빵') || q.includes('제과')) return restaurantsData.items.filter((it) => (it.lclsSystm2 || '').includes('FD03')).slice(0, limit)

  // broad recommendation for vague queries
  if (q.includes('맛집') || q.includes('추천') || q.includes('추천해')) {
    const withImage = restaurantsData.items.filter((it) => it.firstimage || it.firstimage2).slice(0, limit)
    return withImage.length ? withImage : restaurantsData.items.slice(0, limit)
  }

  return []
}
// searchResults is no longer used globally; candidates are rendered inline in chatMessages
const mapInstance = ref(null)
const mapReady = ref(false)
const markerGroup = ref(null)
const showMarkers = ref(true) // markers shown by default
const restaurantList = ref(restaurantsData.items)

// --- 카테고리 필터 관련 상태 (선택 항목에 '기타' 추가) ---
const selectedCategory = ref('전체')
const categoryOptions = ['전체', '한식', '일식', '중식', '양식', '카페', '기타']

const tabOptions = [
  { label: '메인', value: '메인' },
  { label: '자유주제', value: '자유주제' },
  { label: '가게리뷰', value: '가게리뷰' },
  { label: '북마크', value: '북마크' },
]

// --- 강화된 카테고리 자동 판별 함수 ---
const getRestaurantType = (restaurant) => {
  const cat = (restaurant.category || '').replace(/\s+/g, '')
  const title = (restaurant.title || '').replace(/\s+/g, '')
  
  // 1. 카페 및 디저트류 (제과, 베이커리, 전통찻집, 빙수 등 포함)
  if (
    cat.includes('카페') || cat.includes('제과') || cat.includes('디저트') || cat.includes('빵') || cat.includes('커피') || cat.includes('아이스크림') ||
    title.includes('카페') || title.includes('빵') || title.includes('베이커리') || title.includes('제과') || title.includes('커피') || 
    title.includes('설빙') || title.includes('다방') || title.includes('에스프레소') || title.includes('디저트') || title.includes('샌드위치')
  ) {
    return '카페'
  }

  // 2. 일식 (초밥, 우동, 소바, 이자카야, 라멘, 돈가스 등)
  if (
    cat.includes('일식') || cat.includes('초밥') || cat.includes('스시') || cat.includes('돈까스') || cat.includes('우동') || cat.includes('소바') ||
    title.includes('스시') || title.includes('초밥') || title.includes('돈까스') || title.includes('돈가스') || title.includes('카츠') || 
    title.includes('라멘') || title.includes('우동') || title.includes('소바') || title.includes('연어') || title.includes('참치') || 
    title.includes('이자카야') || title.includes('텐동') || title.includes('규동') || title.includes('가츠')
  ) {
    return '일식'
  }

  // 3. 중식 (짜장, 짬뽕, 양꼬치, 마라탕, 딤섬 등)
  if (
    cat.includes('중식') || cat.includes('중화') || cat.includes('마라탕') || cat.includes('양꼬치') ||
    title.includes('반점') || title.includes('중화') || title.includes('짜장') || title.includes('짬뽕') || 
    title.includes('객주') || title.includes('마라') || title.includes('양꼬치') || title.includes('양갈비') || 
    title.includes('딤섬') || title.includes('차이나') || title.includes('취홍') || title.includes('성경만두')
  ) {
    return '중식'
  }

  // 4. 양식 (파스타, 피자, 스테이크, 패밀리레스토랑, 햄버거, 펍 등)
  if (
    cat.includes('양식') || cat.includes('경양식') || cat.includes('패밀리레스토랑') || cat.includes('햄버거') || cat.includes('피자') || cat.includes('파스타') ||
    title.includes('파스타') || title.includes('피자') || title.includes('스테이크') || title.includes('이탈리') || title.includes('키친') || 
    title.includes('버거') || title.includes('레스토랑') || title.includes('바베큐') || title.includes('바비큐') || title.includes('다이닝') || 
    title.includes('펍') || title.includes('비스트로') || title.includes('플레이트')
  ) {
    return '양식'
  }

  // 5. 한식 (찌개, 탕, 고기구이, 족발, 보쌈, 전, 닭갈비, 분식 등 광범위한 한식류 매칭)
  if (
    cat.includes('한식') || cat.includes('분식') || cat.includes('백반') || cat.includes('갈비') || cat.includes('삼겹살') || cat.includes('국밥') ||
    title.includes('식당') || title.includes('국밥') || title.includes('집') || title.includes('가든') || title.includes('옥') || 
    title.includes('가') || title.includes('관') || title.includes('분식') || title.includes('국수') || title.includes('칼국수') || 
    title.includes('면옥') || title.includes('갈비') || title.includes('구이') || title.includes('삼겹살') || title.includes('숯불') || 
    title.includes('고기') || title.includes('해장국') || title.includes('감자탕') || title.includes('찌개') || title.includes('매운탕') || 
    title.includes('족발') || title.includes('보쌈') || title.includes('닭갈비') || title.includes('찜닭') || title.includes('백숙') || 
    title.includes('삼계탕') || title.includes('추어탕') || title.includes('설렁탕') || title.includes('곰탕') || title.includes('밥상') || 
    title.includes('쌈밥') || title.includes('보리밥') || title.includes('순대') || title.includes('떡볶이') || title.includes('오뎅') || 
    title.includes('전') || title.includes('지지미') || title.includes('한우') || title.includes('구이') || title.includes('포차') ||
    title.includes('낙지') || title.includes('쭈꾸미') || title.includes('아구찜') || title.includes('게장')
  ) {
    return '한식'
  }

  return '기타'
}

const selectedRestaurantImage = computed(() => {
  if (!selectedRestaurant.value) return ''
  return selectedRestaurant.value.firstimage || selectedRestaurant.value.firstimage2 || ''
})

const mapLink = computed(() => {
  if (!selectedRestaurant.value) return ''
  const lat = selectedRestaurant.value.mapy
  const lng = selectedRestaurant.value.mapx
  if (lat && lng) return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(selectedRestaurant.value.addr1 || selectedRestaurant.value.title)}`
})

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

  // initialize Leaflet map (no API key required)
  if (typeof window !== 'undefined') {
    setTimeout(() => initLeafletMap(), 50)
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

// render markers when map is ready
watch([mapReady, restaurantList], () => {
  if (mapReady.value) {
    renderMarkers()
  }
})

watch(restaurantList, () => {
  if (mapReady.value) {
    renderMarkers()
  }
})
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
  let result = restaurantList.value

  // 1. 검색어 필터링
  if (keyword) {
    result = result.filter((item) => {
      const haystack = [item.title, item.addr1].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }

  // 2. 카테고리 필터링 (이제 '기타' 필터링도 정상 작동합니다.)
  if (selectedCategory.value !== '전체') {
    result = result.filter((item) => {
      return getRestaurantType(item) === selectedCategory.value
    })
  }

  return result
})

const selectedRestaurantReviews = computed(() => {
  if (!selectedRestaurant.value) return []
  return posts.value.filter((post) => {
    return post.category === '가게리뷰' && post.restaurantName === selectedRestaurant.value.title
  })
})

const selectedRestaurantAverage = computed(() => {
  if (!selectedRestaurantReviews.value.length) return '0.0'
  const sum = selectedRestaurantReviews.value.reduce((total, r) => total + Number(r.rating || 0), 0)
  return (sum / selectedRestaurantReviews.value.length).toFixed(1)
})

const resetForm = () => {
  form.value = {
    nickname: '',
    password: '',
    title: '',
    content: '',
    category: activeTab.value === '가게리뷰' ? '가게리뷰' : '자유주제',
    restaurantName: selectedRestaurant.value?.title || '',
    rating: 5,
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
        ,
        rating: Number(form.value.rating || 0)
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
    rating: Number(form.value.rating || 0),
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
  if (mapInstance.value) {
    const lat = Number(restaurant.mapy)
    const lng = Number(restaurant.mapx)
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      mapInstance.value.setView([lat, lng], 16, { animate: true })
    }
  }
  // auto search related blogs for the selected restaurant
  blogQuery.value = restaurant.title || ''
  // call search but don't block UI
  try { searchNaverBlogs() } catch (e) { console.warn('blog search failed', e) }
}

const createMasconDivIcon = (title) => {
  const html = `
    <div class="mascot-badge" title="${(title || '').replace(/"/g,'')}">
      <img src="/assets/mascot.png" alt="m" />
    </div>
  `

  return L.divIcon({
    html,
    className: 'mascot-div-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -20]
  })
}


const initLeafletMap = () => {
  const container = document.getElementById('kakao-map')
  if (!container) return

  mapInstance.value = L.map(container).setView([36.35, 127.38], 10)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(mapInstance.value)

  mapReady.value = true
}

async function searchNaverBlogs() {
  const q = (blogQuery.value || '').trim()
  if (!q) return alert('검색어를 입력하세요')
  try {
    const resp = await fetch(`/.netlify/functions/naverBlog?q=${encodeURIComponent(q)}`)
    if (!resp.ok) {
      const t = await resp.text()
      throw new Error(t)
    }
    const json = await resp.json()
    blogResults.value = json.items || []
  } catch (err) {
    console.error(err)
    alert('블로그 검색에 실패했습니다.')
  }
}

async function summarizeBlog(blog) {
  if (!blog || !blog.description) return
  if (!OPENAI_KEY) return alert('OpenAI 키가 설정되지 않았습니다.')
  try {
    blog.__loading = true
    const prompt = `다음 블로그 요약을 한국어로 2문장 이하로 간결하게 요약해줘.\n\n${blog.description}`
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], max_tokens: 120, temperature: 0.5 }),
    })
    const data = await resp.json()
    const text = data?.choices?.[0]?.message?.content || ''
    blog.__summary = text
  } catch (err) {
    console.error(err)
    blog.__summary = '요약 실패'
  } finally {
    blog.__loading = false
  }
}

async function analyzeBlog(blog) {
  if (!blog || !blog.description) return
  if (!OPENAI_KEY) return alert('OpenAI 키가 설정되지 않았습니다.')
  const systemPrompt = `당신은 온라인 리뷰가 사람이 작성한 실제 후기인지, 아니면 AI(예: GPT, CLOVA 등)를 이용해 기계적으로 대량 생성한 'AI 생성 리뷰'인지를 판별하는 텍스트 분석 전문가입니다.\n\n다음 특징들을 기준으로 주어진 리뷰를 평가해줘:\n1. 지나치게 정돈된 문장 구조와 백과사전식 표현\n2. 감정의 깊이 부족\n3. 어색하거나 지나치게 기계적인 접속사 사용\n4. 반복적인 키워드 배치 패턴\n\n응답은 반드시 JSON 형식으로 다음과 같이만 반환하세요.\n{\n  "ai_writing_probability_percentage": 0,\n  "reasons": ["..."],\n  "verdict": "사람 작성 의심"\n}`
  try {
    blog.__loading = true
    const userPayload = `리뷰: ${blog.description}`
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPayload }], max_tokens: 200, temperature: 0.2 }),
    })
    const data = await resp.json()
    const aiText = data?.choices?.[0]?.message?.content || ''
    let parsed = null
    try { parsed = JSON.parse(aiText) } catch (e) { parsed = { ai_writing_probability_percentage: null, reasons: [aiText], verdict: '판단 보류' } }
    blog.__analysis = parsed
  } catch (err) {
    console.error(err)
    blog.__analysis = { ai_writing_probability_percentage: null, reasons: ['분석 실패'], verdict: '판단 보류' }
  } finally {
    blog.__loading = false
  }
}

async function batchAnalyzeAll() {
  if (!blogResults.value || blogResults.value.length === 0) return
  for (const b of blogResults.value) {
    // sequential to avoid rate limits
    await analyzeBlog(b)
  }
  alert('일괄 분석 완료')
}

function renderMarkers() {
  console.log("renderMarkers 실행됨")
  console.log("지도:", mapInstance.value)
  console.log("데이터:", restaurantList.value)
  console.log("showMarkers:", showMarkers.value)

  if (!mapInstance.value) return

  // 마커 숨김 상태면 제거
  if (!showMarkers.value) {
    if (markerGroup.value) {
      markerGroup.value.clearLayers()
    }
    return
  }

  // markerGroup 생성
  if (!markerGroup.value) {
    markerGroup.value = L.layerGroup()
  }

  // mascot 이미지 마커 아이콘
  const markerIcon = L.icon({
    iconUrl: '/assets/mascot.png',
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  })

  // add markers to group
  restaurantList.value.forEach((restaurant) => {
    const lat = Number(restaurant.mapy)
    const lng = Number(restaurant.mapx)

    if (Number.isNaN(lat) || Number.isNaN(lng)) return

    const m = L.marker([lat, lng], {
      icon: markerIcon
    })

    m.bindPopup(`
      <div style="padding:8px 10px; font-size:13px;">
        <strong>${restaurant.title}</strong><br/>
        ${restaurant.addr1}
      </div>
    `)

    m.on('click', () => {
      selectRestaurant(restaurant)
      m.openPopup()
    })

    markerGroup.value.addLayer(m)
  })

  // 지도에 마커 표시
  try {
    markerGroup.value.addTo(mapInstance.value)
  } catch (e) {
    console.log("마커 추가 오류:", e)
  }
}

// toggleMarkers removed — markers are shown by default
const toggleMarkers = () => {
  showMarkers.value = !showMarkers.value
  renderMarkers()
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

  // 간단한 의도 분류: 음식점 추천 관련 질의인지 여부
  const isRestaurantQueryText = (s) => {
    if (!s) return false
    const low = s.toLowerCase()
    const kws = ['맛집', '추천', '식당', '대전', '가게', '음식', '맛있는', '여행지', '관광', '카페', '맛집추천', '추천해']
    return kws.some((k) => low.includes(k))
  }

  const isFood = isRestaurantQueryText(text)
  const low = text.toLowerCase()
  const greetings = ['안녕', '안녕하세요', '하이', 'hello', 'hi', '반가워', '잘 지내']

  // 간단한 인사/잡담은 로컬에서 응답
  if (!isFood && greetings.some((g) => low.includes(g))) {
    chatMessages.value.push({ role: 'bot', text: '안녕하세요! 대전 지역 음식점이나 관광 정보, 추천이 필요하시면 편하게 말씀해 주세요.' })
    return
  }

  // 음식점 관련 질의가 아니라면 일반 대화 모드로 OpenAI에 자연스러운 응답 요청
  if (!isFood) {
    if (!OPENAI_KEY) {
      chatMessages.value.push({ role: 'bot', text: '현재는 일반 대화 기능을 사용할 수 없습니다. 음식점 추천을 요청해 보세요.' })
      return
    }
    const generalSystem = `당신은 친절한 지역 안내 챗봇입니다. 사용자의 질문에 공감하고 자연스럽게 대화하세요. 필요하면 대전 음식점 데이터에 기반한 추천을 제안하되, 일반적인 질문에는 대화형 한국어 문장으로 응답하세요.`
    // show typing indicator
    isProcessing.value = true
    const tempIdx = chatMessages.value.push({ role: 'bot', text: '...', temp: true }) - 1

    const messages = buildLLMMessages(generalSystem, text)
    const respGen = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'gpt-3.5-turbo', messages, max_tokens: 300, temperature: 0.7 }),
    })
    if (!respGen.ok) {
      const t = await respGen.text()
      // remove temp indicator
      if (chatMessages.value[tempIdx] && chatMessages.value[tempIdx].temp) chatMessages.value.splice(tempIdx, 1)
      isProcessing.value = false
      throw new Error('OpenAI error: ' + t)
    }
    const dataGen = await respGen.json()
    const replyText = dataGen?.choices?.[0]?.message?.content || '죄송합니다. 다시 시도해 주세요.'
    // replace temp indicator with actual reply
    if (chatMessages.value[tempIdx] && chatMessages.value[tempIdx].temp) {
      chatMessages.value[tempIdx] = { role: 'bot', text: replyText }
    } else {
      chatMessages.value.push({ role: 'bot', text: replyText })
    }
    isProcessing.value = false
    return
  }

  try {
    const POOL_SIZE = 60
    // prioritize retrieved hits, then pad with generic items
    let poolItems = retrieve(text, POOL_SIZE)
    if (!poolItems || poolItems.length === 0) poolItems = restaurantsData.items.slice(0, POOL_SIZE)
    if (poolItems.length < POOL_SIZE) {
      const ids = new Set(poolItems.map((i) => i.contentid))
      const pad = restaurantsData.items.filter((r) => !ids.has(r.contentid)).slice(0, POOL_SIZE - poolItems.length)
      poolItems = poolItems.concat(pad)
    }

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
- 그러나 카테고리 지정이 불명확하거나 실패하면, 제공된 items 중 '유사도'가 가장 높은 항목을 골라 최대 6개를 구성하세요. 즉각적으로 빈 배열을 반환하지 마세요.
- 사용자가 특정 카테고리를 엄격히 요청하면 그 카테고리와 명확히 일치하는 항목을 우선하세요. 만약 전혀 없으면, 가장 관련성이 높은 항목을 제공하시고 그 사유를 간단히 요약해 주세요.
- 관련 항목이 전혀 없다고 판단되면 "candidates"를 빈 배열로 하고 "reply"에 정확히 이 문구를 넣으세요: "죄송합니다. 대전 지역 음식점 관련 질문을 해주세요."`

    const userPayload = `items:\n${JSON.stringify(itemsForLLM)}\n\n질문: ${text}`

    if (!OPENAI_KEY) {
      // No key configured — fallback to local retrieval
      const fallbackHits = retrieve(text, 6)
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
      if (reply) chatMessages.value.push({ role: 'bot', text: reply })
      if (candidates.length) chatMessages.value.push({ role: 'bot', candidates })
      return
    }

    // show typing indicator
    isProcessing.value = true
    const tempIdx = chatMessages.value.push({ role: 'bot', text: '...', temp: true }) - 1

    const messages = buildLLMMessages(systemPrompt, userPayload)
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: 700,
        temperature: 0.2,
      }),
    })

    if (!resp.ok) {
      const txt = await resp.text()
      throw new Error('OpenAI error: ' + txt)
    }

    const data = await resp.json()
    const aiText = data?.choices?.[0]?.message?.content
    if (!aiText) {
      if (chatMessages.value[tempIdx] && chatMessages.value[tempIdx].temp) chatMessages.value.splice(tempIdx, 1)
      isProcessing.value = false
      chatMessages.value.push({ role: 'bot', text: '죄송합니다. 대전 지역 음식점 관련 질문을 해주세요.' })
      return
    }

    let parsed = null
    try {
      parsed = JSON.parse(aiText)
    } catch (e) {
      // If LLM didn't return strict JSON, show text answer
      chatMessages.value.push({ role: 'bot', text: aiText })
      return
    }

    const reply = parsed.reply || '죄송합니다. 대전 지역 음식점 관련 질문을 해주세요.'
    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : []

    const byId = new Map(restaurantsData.items.map((r) => [String(r.contentid), r]))
    const validated = []
    for (const c of rawCandidates.slice(0, 6)) {
      const id = String(c.contentid || '')
      if (!id) continue
      const full = byId.get(id)
      if (!full) continue
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
      if (chatMessages.value[tempIdx] && chatMessages.value[tempIdx].temp) chatMessages.value.splice(tempIdx, 1)
      isProcessing.value = false
      chatMessages.value.push({ role: 'bot', text: '죄송합니다. 대전 지역 음식점 관련 질문을 해주세요.' })
      return
    }

    // replace temp indicator with reply + candidates
    if (chatMessages.value[tempIdx] && chatMessages.value[tempIdx].temp) {
      const replacement = { role: 'bot', text: reply }
      if (validated.length) replacement.candidates = validated
      chatMessages.value[tempIdx] = replacement
    } else {
      if (reply) chatMessages.value.push({ role: 'bot', text: reply })
      if (validated.length) chatMessages.value.push({ role: 'bot', candidates: validated })
    }
    isProcessing.value = false
  } catch (err) {
    console.error(err)
    chatMessages.value.push({ role: 'bot', text: '서버에 연결할 수 없습니다.' })
  }
}

// 자동 스크롤: 채팅 메시지 변경 시 하단으로 이동
watch(
  chatMessages,
  async () => {
    await nextTick()
    try {
      const el = chatLogRef.value
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      }
    } catch (e) {
      // ignore
    }
  },
  { deep: true },
)

function handleFollowupClick(query) {
  // set the query and force one search even if query looks trivial
  skipTrivialOnce.value = true
  chatInput.value = query
  // small delay to allow UI update then send
  setTimeout(() => sendChatMessage(), 50)
}

function buildLLMMessages(systemPrompt, userText) {
  // include recent conversation turns for context (limit to last 8 messages)
  const recent = chatMessages.value.slice(-8)
  const messages = [{ role: 'system', content: systemPrompt }]
  for (const m of recent) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.text })
    else if (m.role === 'bot' && m.text) messages.push({ role: 'assistant', content: m.text })
  }
  // finally include current user text
  messages.push({ role: 'user', content: userText })
  return messages
}

function makeMapLink(item) {
  const lat = item.mapy || ''
  const lng = item.mapx || ''
  const title = item.title || ''
  if (lat && lng) return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`
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
<div class="popular-sidebar">
  <!-- 항상 보이는 아이콘 -->
  <div class="popular-icon">
    🔥
  </div>

  <!-- hover 시 나타나는 리스트 -->
  <div class="popular-list">
    <h3>이번 주 인기맛집</h3>

    <div 
      v-for="(restaurant, index) in popularRestaurants"
      :key="restaurant.id"
      class="popular-item"
      @click="selectPopularRestaurant(restaurant)"
    >
      <span>{{ index + 1 }}</span>
      {{ restaurant.title }}
    </div>
  </div>
</div>
  <div class="app-shell">
    <header class="hero">
      <div class="hero-left">
        <div class="brand">
          <img class="brand-mascot" src="/assets/mascot.png" alt="골라유 마스코트" onerror="this.style.display='none'" />
          골라유
        </div>
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
          <div style="display:flex; gap:8px; align-items:center;">
            <div class="search-row">
              <input v-model="restaurantSearch" placeholder="식당 이름 또는 주소 검색" />
              <button type="button" class="primary search-btn">🔍</button>
              <button @click="toggleMarkers">
                {{ showMarkers ? '마커 숨기기' : '마커 보기' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 업종별 카테고리 필터바 영역 -->
        <div class="category-filter-bar">
          <button
            v-for="cat in categoryOptions"
            :key="cat"
            type="button"
            class="filter-chip"
            :class="{ active: selectedCategory === cat }"
            @click="selectedCategory = cat"
          >
            {{ cat }}
          </button>
        </div>

        <div id="kakao-map" class="kakao-map"></div>
        <div v-if="!mapReady && MAP_KEY" class="map-loading">지도를 불러오는 중입니다...</div>
        <div v-else-if="!MAP_KEY" class="map-loading"></div>

        <!-- 세로 1줄 목록 형태로 교체된 영역 -->
        <div class="restaurant-list-container">
          <div v-if="filteredRestaurants.length" class="restaurant-vertical-list">
            <button
              v-for="restaurant in filteredRestaurants"
              :key="restaurant.title"
              type="button"
              class="restaurant-list-item"
              :class="{ selected: selectedRestaurant && selectedRestaurant.title === restaurant.title }"
              @click="selectRestaurant(restaurant)"
            >
              <div class="item-info">
                <span class="item-category-tag">{{ getRestaurantType(restaurant) }}</span>
                <strong class="item-title">{{ restaurant.title }}</strong>
                <p class="item-addr">{{ restaurant.addr1 }}</p>
              </div>
            </button>
          </div>
          <div v-else class="empty-list-state">
            선택한 카테고리나 검색어에 해당하는 식당이 없습니다.
          </div>
        </div>
        
      </div>

      <div class="review-card">
        <h2>선택한 가게 정보</h2>

        <div v-if="selectedRestaurant" class="selected-store">
          <strong>{{ selectedRestaurant.title }}</strong>
          <p>{{ selectedRestaurant.addr1 }}</p>
          <div class="store-rating">⭐ 평균 별점 {{ selectedRestaurantAverage }} / 5.0</div>

          <div v-if="selectedRestaurantImage" class="store-image">
            <img :src="selectedRestaurantImage" :alt="selectedRestaurant.title" />
          </div>

          <div class="kakao-place-info">
            <a v-if="mapLink" :href="mapLink" target="_blank" rel="noreferrer">
              지도에서 위치 보기
            </a>
          </div>

          <div class="blog-results-store" style="margin-top:12px;">
            <h4 style="margin:6px 0; font-size:13px;">관련 블로그</h4>
            <div v-if="blogResults.length" style="display:flex; flex-direction:column; gap:8px; max-height:220px; overflow:auto;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:12px; color:#6b7280;">{{ blogResults.length }}건</div>
                <div>
                  <button class="secondary" @click="batchAnalyzeAll">일괄 AI 판별</button>
                </div>
              </div>
              <div v-for="(b, i) in blogResults" :key="i" style="padding:8px; background:#fff; border-radius:8px; border:1px solid rgba(0,0,0,0.04);">
                <a :href="b.link" target="_blank" rel="noopener noreferrer" style="text-decoration:none; color:inherit;">
                  <strong v-html="b.title"></strong>
                </a>
                <div style="font-size:12px; color:#6b7280; margin-top:4px;">{{ b.bloggername }} · {{ b.postdate }}</div>
                <p style="margin:6px 0 0; font-size:13px; color:#4b5563;" v-html="b.description"></p>
                <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
                  <button class="secondary" @click="summarizeBlog(b)">요약</button>
                  <button class="primary" @click="analyzeBlog(b)">AI 판별</button>
                  <div v-if="b.__loading" style="font-size:12px;color:#9ca3af;">분석 중...</div>
                </div>
                <div v-if="b.__summary" style="margin-top:8px; color:#4b5563; font-size:13px;">요약: {{ b.__summary }}</div>
                <div v-if="b.__analysis" style="margin-top:8px; font-size:13px;">
                  <div><strong>판정:</strong> {{ b.__analysis.verdict }}</div>
                  <div><strong>AI 의심도:</strong> {{ b.__analysis.ai_writing_probability_percentage ?? 'N/A' }}%</div>
                  <div><strong>이유:</strong>
                    <ul>
                      <li v-for="(r, ri) in b.__analysis.reasons" :key="ri">{{ r }}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            <div v-else style="color:#9ca3af; font-size:13px;">관련 블로그가 없습니다.</div>
          </div>
        </div>

        <div v-else class="empty-state">지도에서 가게를 선택하면 장소 정보가 나타납니다.</div>

        <div v-for="review in selectedRestaurantReviews" :key="review.id" class="review-item">
          <div class="review-header">
            <strong>{{ review.title }}</strong>
            <div style="display:flex; gap:8px; align-items:center;">
              <span>⭐ {{ Number(review.rating || 0).toFixed(1) }}</span>
              <span>{{ review.nickname }}</span>
            </div>
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
            {{ activeTab === '자유주제'
              ? '자유롭게 이야기하는 공간입니다.'
              : activeTab === '가게리뷰'
              ? '가게 후기를 남기는 공간입니다.'
              : '북마크한 글만 모아봅니다.' }}
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
            <span v-if="post.category === '가게리뷰'" style="margin-left:8px;">⭐ {{ Number(post.rating || 0).toFixed(1) }}</span>
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
          <div v-if="form.category === '가게리뷰'">
            <input v-model="form.restaurantName" placeholder="가게 이름" />
            <div v-if="restaurantSuggestions.length" class="suggestion-box">
              <div v-for="name in restaurantSuggestions" :key="name" class="suggestion-item" @click="form.restaurantName = name">{{ name }}</div>
            </div>

            <div class="rating-box">
              <label>별점</label>
              <input type="range" min="0.5" max="5" step="0.5" v-model.number="form.rating" />
              <span>{{ Number(form.rating || 0).toFixed(1) }}점</span>
            </div>
          </div>

          <div class="modal-actions">
            <button type="submit" class="primary">{{ isEditMode ? '수정' : '등록' }}</button>
          </div>
        </form>
      </div>
    </div>

    <button type="button" class="chat-toggle" @click="isChatOpen = !isChatOpen">
      💬
    </button>

    <img class="mascot-float" src="/assets/mascot.png" alt="mascot" onerror="this.style.display='none'" />

    <div v-if="isChatOpen" class="chat-float">
      <div class="chat-header">
        <strong>챗봇</strong>
        <button type="button" class="chat-close" @click="isChatOpen = false">×</button>
      </div>

      <div class="chat-log" ref="chatLogRef">
        <div v-for="(message, index) in chatMessages" :key="index" class="message" :class="message.role">
          <strong>{{ message.role === 'user' ? '나' : '챗봇' }}</strong>
          <p v-if="message.text">{{ message.text }}</p>

          <!-- candidates가 있는 bot 메시지는 카드형 가로 스크롤로 표시 -->
              <div v-if="message.candidates && message.candidates.length" class="candidate-row" @wheel="onCandidateWheel">
            <div v-for="(r, i) in message.candidates" :key="i" class="candidate-card">
              <a :href="r.place_url || makeMapLink(r)" target="_blank" rel="noopener noreferrer">
                <div class="thumb-small">
                  <img v-if="r.firstimage" :src="r.firstimage" alt="img" loading="lazy" @error="onImgError($event, r.title)" />
                  <div v-else class="noimg">이미지 없음</div>
                </div>
              </a>
              <div class="meta-small">
                <strong class="title"><a :href="r.place_url || makeMapLink(r)" target="_blank" rel="noopener noreferrer">{{ r.title }}</a></strong>
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
        <input v-model="chatInput" @keyup.enter="sendChatMessage" :disabled="isProcessing" placeholder="질문을 입력하세요" />
        <button type="button" @click="sendChatMessage" :disabled="isProcessing">{{ isProcessing ? '...' : '전송' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background: #FFF5F3;
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
}

.popular-sidebar {
  position: absolute;
  left: 20px;
  top: 120px;
  display: flex;
  align-items: center;
  z-index: 1000;
}


/* 항상 보이는 아이콘 */
.popular-icon {
  width: 50px;
  height: 50px;
  background: #e07a3b;
  color: white;
  border-radius: 50%;

  display: flex;
  align-items: center;
  justify-content: center;

  font-size: 24px;
  cursor: pointer;
}


/* 기본은 숨김 */
.popular-list {
  width: 260px;
  background: white;
  margin-left: 10px;
  padding: 15px;

  border-radius: 15px;
  box-shadow: 0 5px 20px rgba(0,0,0,0.15);

  opacity: 0;
  visibility: hidden;
  transform: translateX(-20px);

  transition: 0.3s;
}


/* 아이콘 위에 올리면 표시 */
.popular-sidebar:hover .popular-list {
  opacity: 1;
  visibility: visible;
  transform: translateX(0);
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
  background: linear-gradient(90deg, #fff8f2, #ffffff);
  box-shadow: 0 10px 30px rgba(224, 122, 59, 0.06);
  margin-bottom: 24px;
}

.hero-left {
  display: flex;
  align-items: center;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  font-size: 26px;
  font-weight: 800;
  color: #e07a3b;
}


.brand-mascot {
  width: 44px;
  height: 44px;
  object-fit: contain;
  margin-right: 10px;
  transform: none;
}
/* mascot animations and badge */
@keyframes bob {
  0% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
  100% { transform: translateY(0); }
}

.brand-mascot, .mascot-float {
  animation: bob 3s ease-in-out infinite;
}

.mascot-badge {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(255,155,87,1), rgba(224,122,59,1));
  box-shadow: 0 3px 8px rgba(224,122,59,0.28);
  border: 2px solid rgba(255,255,255,0.95);
}
.mascot-badge img { width: 56%; height: 56%; object-fit: contain; border-radius:50%; }
.mascot-div-icon { background: transparent; }

.brand-mascot:hover, .mascot-float:hover { transform: scale(1.06); transition: transform 160ms ease; }

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
  background: #fbf6f2;
}

.nav-item.active {
  color: white;
  background: #e07a3b;
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
  color: #e07a3b;
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
  border: 1px solid #d1d5db;
  border-radius: 10px;
  padding: 10px 12px;
  box-sizing: border-box;
}

.kakao-map {
  width: 100%;
  height: 380px;
  border-radius: 18px;
  background: #fbf6f2;
  border: none;
}

.map-loading {
  margin-top: 10px;
  color: #6b7684;
}

/* 카테고리 필터 가로 바 */
.category-filter-bar {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 0 12px;
  scrollbar-width: none;
}
.category-filter-bar::-webkit-scrollbar {
  display: none;
}

.filter-chip {
  background: #f3f4f6;
  color: #4b5563;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.filter-chip:hover {
  background: #e5e7eb;
  color: #1f2937;
}

.filter-chip.active {
  background: #bb4a1a;
  color: white;
  border-color: #bb4a1a;
}

/* 세로 목록형 식당 리스트 스타일 */
.restaurant-list-container {
  margin-top: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #f8fafc;
  overflow: hidden;
}

.restaurant-vertical-list {
  display: flex;
  flex-direction: column;
  max-height: 280px; /* 세로 스크롤 범위 설정 */
  overflow-y: auto;
}

.restaurant-list-item {
  width: 100%;
  text-align: left;
  background: white;
  border: none;
  border-bottom: 1px solid #e5e7eb;
  padding: 12px 16px;
  transition: background 0.2s ease;
  border-radius: 0;
  display: flex;
  align-items: center;
}

.restaurant-list-item:last-child {
  border-bottom: none;
}

.restaurant-list-item:hover {
  background: #f1f5f9;
}

.restaurant-list-item.selected {
  background: #fff6f0;
  border-left: 4px solid #bb4a1a;
  padding-left: 12px;
}

.item-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.item-category-tag {
  align-self: flex-start;
  font-size: 10px;
  font-weight: 700;
  color: #2f855a;
  background: #e6f4ec;
  padding: 2px 6px;
  border-radius: 4px;
}

.item-title {
  font-size: 14px;
  color: #1f2937;
  font-weight: 700;
}

.item-addr {
  margin: 0;
  font-size: 12px;
  color: #6b7280;
}

.empty-list-state {
  padding: 24px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  background: white;
}

.selected-store {
  margin-bottom: 12px;
  padding: 10px;
  border-radius: 12px;
  background: #f8fafc;
}

.store-image {
  margin-top: 12px;
  border-radius: 14px;
  overflow: hidden;
  background: #f8fafc;
}

.store-image img {
  width: 100%;
  height: auto;
  display: block;
  object-fit: cover;
}

.kakao-place-info {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
}

.kakao-place-info a {
  display: inline-block;
  margin-top: 8px;
  color: #e07a3b;
  text-decoration: none;
}

.review-item {
  padding: 14px 0;
  border-bottom: 1px solid #fbf6f2;
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
  background: #fff3ea;
  color: #8a3b15;
  font-weight: 600;
  font-size: 12px;
}

.restaurant-link {
  margin-top: 10px;
  color: #e07a3b;
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
  background: #fbf6f2;
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
  color: #ffb74d;
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
  background: linear-gradient(135deg, #ff9b57, #e07a3b);
  color: white;
  font-size: 26px;
  cursor: pointer;
  box-shadow: 0 12px 30px rgba(224,122,59,0.22);
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
  background: #e07a3b;
  color: white;
}

button.primary:hover {
  background: #8a3b15;
}

button.secondary {
  background: #fbf6f2;
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
  background: linear-gradient(135deg, #ff8a3d, #e07a3b);
  color: white;
  font-size: 22px;
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(224,122,59,0.18);
  z-index: 90;
}

/* chat-mascot removed to avoid duplicate mascot */

.mascot-float {
  position: fixed;
  right: 96px;
  bottom: 18px;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  box-shadow: 0 8px 24px rgba(224,122,59,0.22);
  z-index: 88;
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
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  margin-bottom: 12px;
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
  padding: 12px 14px;
  border-radius: 16px;
  background: #fbf6f2;
  font-size: 14px;
}

.message.bot {
  background: #fff3ea;
  color: #8a3b15;
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

.chat-input-row input:focus {
  outline: none;
  border-color: #000;
  box-shadow: 0 0 0 2px rgba(0,0,0,0.06);
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