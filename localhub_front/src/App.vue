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

const kakaoPlaceLink = computed(() => {
  if (!selectedRestaurant.value) return ''
  if (selectedRestaurant.value.mapx && selectedRestaurant.value.mapy) {
    return `https://map.kakao.com/link/map/${encodeURIComponent(
      selectedRestaurant.value.title
    )},${selectedRestaurant.value.mapy},${selectedRestaurant.value.mapx}`
  }
  return `https://map.kakao.com/link/search/${encodeURIComponent(
    selectedRestaurant.value.addr1 || selectedRestaurant.value.title
  )}`
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

  if (typeof window !== 'undefined' && window.kakao?.maps) {
    initKakaoMap()
  } else if (typeof window !== 'undefined' && MAP_KEY) {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${MAP_KEY}&autoload=false`
    script.onload = () => {
      window.kakao.maps.load(initKakaoMap)
    }
    script.onerror = () => {
      console.error('Kakao SDK 로드 실패', script.src)
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
      mapInstance.value.panTo(moveLatLon)
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
      content: `<div style="padding:8px 10px; font-size:13px;"><strong>${restaurant.title}</strong><br/>${restaurant.addr1}</div>`,
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
        <div v-else-if="!MAP_KEY" class="map-loading">카카오맵 키를 설정하면 실제 지도가 표시됩니다.</div>

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

          <div v-if="selectedRestaurantImage" class="store-image">
            <img :src="selectedRestaurantImage" :alt="selectedRestaurant.title" />
          </div>

          <div class="kakao-place-info">
            <a v-if="kakaoPlaceLink" :href="kakaoPlaceLink" target="_blank" rel="noreferrer">
              카카오맵에서 위치 보기
            </a>
          </div>
        </div>

        <div v-else class="empty-state">지도에서 가게를 선택하면 장소 정보가 나타납니다.</div>

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
  border: 1px solid #d1d5db;
  border-radius: 10px;
  padding: 10px 12px;
  box-sizing: border-box;
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
  background: #2563eb;
  color: white;
  border-color: #2563eb;
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
  background: #eff6ff;
  border-left: 4px solid #2563eb;
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
  color: #2563eb;
  background: #dbeafe;
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
  color: #2563eb;
  text-decoration: none;
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