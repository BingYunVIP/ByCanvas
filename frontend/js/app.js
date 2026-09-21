/* =====================================================
   数据 & 状态
   ===================================================== */
const today = new Date()
function fmt(d) {
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return '今天'
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
function shift(daysAgo) { const d = new Date(); d.setDate(d.getDate() - daysAgo); return d }

const PROMPT_SELFIE = `生成一张 {argument name="比例" default="9:16"} 竖版写实感人物照片，参考高级手机自拍质感，但不要完全普通生活照。整体像是用 iPhone 前置摄像头在温馨卧室中拍摄的精致自拍，保留柔和美型、干净构图和自然高级感。画质为真实手机照片质感，有轻微噪点、轻微柔焦和自然光感，但人物依然精致、漂亮、肤质自然干净，不要变成粗糙低质照片。画面中是一位{argument name="人物描述" default="成年东方女性"}，坐在温馨卧室床上，上半身近景自拍构图，镜头略微从上方俯拍，人物位于画面中央偏右，头部微微低下，视线安静看向右下方，表情自然、平静、温柔，嘴唇自然闭合，整体气质柔和、成熟、安静。人物拥有浅蓝色或冰蓝色长发，发丝自然蓬松，有轻微凌乱感，部分头发垂落在脸侧和肩颈周围。人物保持精致写实美型，脸型柔和自然，五官清秀，皮肤白皙但不过度磨皮，可保留少量真实肤质纹理、细小毛孔、轻微肤色不均和几处很淡的小黑痣，但整体仍然干净、柔和、好看。人物身材丰腴，肩颈线条柔和，胸部饱满，不卡通化。服装为{argument name="服装" default="浅蓝色丝缎吊带睡裙"}，带白色蕾丝花边，胸前有简洁小蝴蝶结和自然褶皱，布料柔软贴合身体，呈现真实丝缎材质光泽。人物一只手自然轻轻拉住肩带或肩部附近衣料，手指数量正常，姿态自然。背景为温馨卧室，有床铺、浅色床品、木质床头柜、暖黄色床头灯、窗帘和柔和室内光。背景轻微虚化，保留真实居家空间感。光线为室内暖光与自然光混合，略微偏暖，画面柔和、亲密、生活化，但保持干净高级。整体风格：写实手机自拍、高级自然美型、轻微 iPhone 前置摄像头质感、柔和暖光、自然肤质、真实比例、温馨卧室、精致但不过度商业修图。`

const PROMPT_CLASSROOM = `Goal: Create a realistic vertical smartphone social-media video screenshot of an after-school classroom scene, styled like a Japanese short-video app post.

Canvas: 9:16 vertical image, 675×1125 style composition, natural daylight, realistic phone-camera look, slight wide-angle perspective, high detail, no illustration style.

Main scene: In a Japanese high school classroom after school, show exactly 2 foreground teenage girls in summer uniforms. The central girl is fully visible from head to mid-thigh, looking directly at the camera with a shy smile, holding a beige smartphone with small cute stickers partly covering her mouth. She has straight {argument name="hair color" default="dark brown"} shoulder-length hair with thin bangs, soft natural makeup, and large expressive eyes. Her left hand holds the strap of a navy shoulder bag. The second girl stands cropped on the right edge, visible from half of her face down to her skirt, smiling gently toward the camera.

Uniform and accessories: Both girls wear crisp white short-sleeve button-up shirts, navy-and-green plaid pleated skirts, and navy striped ribbon bow ties. The central girl carries a glossy navy school bag covered with exactly 8 visible plush keychains and charms: 1 large cream teddy bear, 1 smaller white teddy bear, 1 cream bear with pink bow, 1 fluffy white animal charm, 1 lavender plush charm, 1 pink plush charm, 1 small beige tag charm, and 1 metal chain charm.

Background: A busy classroom with wooden desks and chairs, chalkboard on the back right, tall windows on the left with bright daylight. Include exactly 6 background students in white shirts: 2 seated at desks near the left foreground with backs/side views, 1 standing or leaning near the windows, 2 seated near the middle-back, and 1 seated near the chalkboard. Keep them softly out of focus compared with the foreground girls.

App overlay layout: Add a short-video app interface overlay on top of the photo. Right-side vertical action bar with exactly 5 stacked elements: 1 circular profile thumbnail with a pink plus badge, 1 white heart icon with count “3.2万”, 1 white speech-bubble icon with count “162”, 1 white share arrow icon with count “392”, and 1 small circular spinning-record thumbnail at the bottom. Bottom-left caption area contains the username and post text in white Japanese text: “@{argument name="username" default="yui._.daily"} ・ 3時間前”, then “{argument name="caption text" default="放課後の教室ってなんか特別だよね🧸"}”, then “{argument name="hashtags" default="#jk #放課後 #クラスメイト #日常"}”, then a music line with a musical note icon: “オリジナル楽曲 - yui._.daily”. Bottom black comment bar contains placeholder text “すてきなコメントを書く...” plus exactly 2 icons on the right: an @ symbol and a smiley face.

Visual style: Photorealistic Japanese teen lifestyle snapshot, warm natural lighting, clean skin texture, realistic fabric folds, accurate hands and fingers, believable classroom depth, subtle social-media compression, candid but polished.

Constraints: Preserve the exact counts of foreground girls, background students, plush charms, and overlay elements. Keep the image wholesome and non-explicit. Do not add extra people in the foreground, do not add watermarks, and avoid distorted text or broken hands.`

const PROMPT_DOODLE = `使用上传的参考图像作为严格的身份和服装参考。准确保留面部、五官特征、肤色、发型、发色、配饰、服装以及整体氛围。
创作一幅高质量垂直比例（4:5 或 9:16）的混合媒介肖像，包含：
一个写实的全身体现人物。旁边墙上有一个该人物的黑色手绘涂鸦影子。
真人应显得可爱、略带尴尬、俏皮，并在每次生成时自然地模仿一个新的随机顽皮姿势。涂鸦影子应以更夸张、混乱、卡通化的方式执行相同的姿势创意，并带有漫画动感线、星星、爱心和闪光效果。
使用干净的白色/奶油色工作室墙面，极简背景，柔和的自然光，并确保两个人物完全可见。涂鸦影子应通过发型、配饰、服装轮廓和姿势清晰地与真人相似。
负面提示词：服装变化、身份变化、写实的第二个人物、正常阴影、恐怖、动漫人类、杂乱背景、重复的指向或手指枪姿势、僵硬姿势、多余的肢体/手指、扭曲的身体、文字、水印、标志、AI 伪影。`

const PROMPT_CHART = `请根据附件插图中的角色，创建一个校园剧风格的“人物关系图”。
[要求]
- 主角姓名：[{argument name="character name" default="在此输入姓名"}]
- 将主角置于画面中心，突出显示。
- 以放射状布局围绕主角排列好友、竞争对手、暗恋对象、家人、同学、表亲等。
- 每个角色以可爱的头像或半身剪纸插画形式呈现。
- 使用彩色箭头（→）连接各个人物关系。
- 在箭头旁添加简短、可爱的手写风格注释（例如：“最好的朋友！”、“怦然心动……”、“虽然是竞争对手，但……”）。
- 整体设计采用 {argument name="color theme" default="粉色/粉彩"} 色调，并点缀星星、爱心和花朵等可爱装饰。
- 标题应采用“校园剧人物关系图”风格。
- 营造出温馨有趣的校园青春喜剧氛围。`

const PROMPT_CAFE = `一位美丽的东亚年轻女性坐在户外一家温馨、质朴的巴黎咖啡馆桌旁。她留着长长的波浪状棕色头发，梳成半扎发型，并用一个大号米色缎带蝴蝶结系住。她用手托着下巴，带着柔和自然的妆容，若有所思地望向远方。她身穿一件奶油色罗纹针织开衫毛衣和一条棕色格纹复古半身裙。深色圆形木桌上放着一束用新闻纸包裹的赤陶橙色菊花和一本打开的杂志。温暖的午后黄金时刻阳光在背景中营造出柔和的光晕和散景效果。电影感摄影，浅景深，暖色调，美学风格，高分辨率，8k。`

/* =====================================================
   界面缩放：按屏幕/视口宽度自动放大字号（2K/4K 屏不再过小）
   ===================================================== */
function computeUiScale() {
  const w = window.innerWidth || (window.screen && window.screen.width) || 1440
  if (w >= 2560) return 1.28   // 2K / 2.5K 满屏
  if (w >= 1920) return 1.18   // 1080p 满屏
  if (w >= 1600) return 1.10
  if (w >= 1440) return 1.05
  return 1
}
/**
 * 主内容区左右留白：屏幕越宽留白越大，避免内容铺满浏览器显得压抑。
 * 取「视口宽度的比例」与「固定档位」的较大值，并限制不超过主区宽度的 22%。
 */
function computeGutter() {
  const vw = window.innerWidth || (window.screen && window.screen.width) || 1440
  const mainW = Math.max(vw - 290, 320)   // 290 = 侧边栏宽度
  let g
  if (vw >= 2560) g = Math.max(320, vw * 0.12)
  else if (vw >= 1920) g = Math.max(200, vw * 0.10)
  else if (vw >= 1600) g = Math.max(140, vw * 0.08)
  else if (vw >= 1440) g = Math.max(90, vw * 0.06)
  else if (vw >= 1024) g = 48
  else g = 24
  return Math.round(Math.min(g, mainW * 0.22))
}
function applyUiScale() {
  const root = document.documentElement
  root.style.setProperty('--ui-scale', String(computeUiScale()))
  root.style.setProperty('--gutter', computeGutter() + 'px')
}
applyUiScale()
window.addEventListener('resize', applyUiScale)

const DEFAULT_CONVERSATIONS = [
  {
    id: 1, title: '逼真的 iPhone 自拍风格东亚女性肖像',
    date: fmt(shift(0)), createdAt: Date.now(), pinned: true, active: true,
    prompt: PROMPT_SELFIE,
    images: ['assets/realistic-female-iphone-selfie-portrait.jpg'],
    sentAt: '2026-09-14 14:38', duration: '38.6 秒',
  },
  {
    id: 2, title: '日本教室短视频截图',
    date: fmt(shift(0)), createdAt: Date.now() - 1, pinned: true, active: false,
    prompt: PROMPT_CLASSROOM,
    images: ['assets/japanese-classroom-video-screenshot.jpg'],
    sentAt: '2026-09-14 11:20', duration: '52.3 秒',
  },
  {
    id: 3, title: '真人涂鸦影子',
    date: fmt(shift(1)), createdAt: Date.now() - 2, pinned: false, active: false,
    prompt: PROMPT_DOODLE,
    images: ['assets/real-person-doodle-shadow.jpg'],
    sentAt: '2026-09-13 22:05', duration: '29.8 秒',
  },
  {
    id: 4, title: '校园剧风格人物关系图生成器',
    date: fmt(shift(1)), createdAt: Date.now() - 3, pinned: false, active: false,
    prompt: PROMPT_CHART,
    images: ['assets/school-drama-relationship-chart.jpg'],
    sentAt: '2026-09-13 16:47', duration: '44.1 秒',
  },
  {
    id: 5, title: '巴黎咖啡馆人像',
    date: fmt(shift(2)), createdAt: Date.now() - 4, pinned: false, active: false,
    prompt: PROMPT_CAFE,
    images: ['assets/parisian-cafe-golden-hour.jpg'],
    sentAt: '2026-09-12 09:12', duration: '33.5 秒',
  },
]
/* 每个对话自己的提问历史：「历史提问」面板只显示当前对话的记录。
   示例数据每个对话只有 1 轮真实提问——多轮由用户真实发送后累积，不再伪造。 */
function createExampleConversation(example, id = example.id) {
  return {
    ...example, id, exampleId: example.id, images: [...example.images],
    messages: [{ prompt: example.prompt, images: [...example.images], sentAt: example.sentAt, duration: example.duration }],
  }
}
let conversations = DEFAULT_CONVERSATIONS.map((example) => createExampleConversation(example))
let nextId = 7

/** 每次加载补回默认示例，兼容旧版清空记录；编号冲突时为示例分配新编号。 */
function restoreExampleConversations(saved, deleted = []) {
  const restored = Array.isArray(saved) ? saved.map((c) => ({ ...c })) : []
  const usedIds = new Set(restored.map((c) => String(c.id)))
  let availableId = Math.max(7, ...restored.map((c) => Number(c.id) + 1).filter(Number.isFinite))
  for (const example of DEFAULT_CONVERSATIONS) {
    if (deleted.includes(example.id)) continue
    const existing = restored.find((c) => c.exampleId === example.id
      || (c.exampleId == null && (c.id === example.id || c.images?.includes(example.images[0])
        || c.messages?.some((m) => m.images?.includes(example.images[0])))
        && (c.prompt === example.prompt || c.messages?.[0]?.prompt === example.prompt)))
    if (!existing) {
      const id = usedIds.has(String(example.id)) ? availableId++ : example.id
      usedIds.add(String(id))
      restored.push(createExampleConversation(example, id))
      continue
    }
    const original = createExampleConversation(example, existing.id)
    const messages = Array.isArray(existing.messages) ? [...existing.messages] : []
    // 已生成的新结果和后续提问都保留，只修补缺少的原始示例轮次或图片。
    const index = messages.findIndex((m) => m.prompt === example.prompt
      && m.images?.some((src) => example.images.includes(src)))
    if (index < 0) {
      const emptyIndex = messages.findIndex((m) => m.prompt === example.prompt && !m.images?.length && !m.text)
      if (emptyIndex >= 0) messages[emptyIndex] = original.messages[0]
      else messages.unshift(original.messages[0])
    }
    const createdAt = existing.createdAt ?? original.createdAt
    Object.assign(existing, { ...original, ...existing, messages, createdAt, exampleId: example.id })
  }
  return restored
}
/** 历史提问 = 当前对话里每一轮的提问 */
function conversationRounds(c) {
  return Array.isArray(c && c.messages) ? c.messages : []
}

let activeId = 1
let openMenuId = null
let renamingId = null
let renamingValue = ''
let isRunning = false
let currentAbort = null   // 生成中的请求，点发送 = 取消它
/** 正在生成的那一轮，格式 `${会话id}:${轮次下标}`。
    用来在气泡里显示转圈，而不是留一个空白的「总耗时：」。 */
let runningRoundKey = null
/** 这一轮是出图还是文本回复：'image' | 'chat' */
let runningRoundKind = 'image'
/** 流式输出中已收到的正文 / 推理内容。后端 SSE 已经在逐段推了，
    以前是把它们攒成整段结束后才渲染，流式等于白做 —— 现在边收边显示。 */
let streamingText = ''
let streamingReasoning = ''
let streamRenderFrame = null
let darkMode = false
let searchQuery = ''

/* =====================================================
   对话分组：内置「置顶 / 其他」+ 用户自建分组
   分组名可双击重命名；自建分组即使为空也保留显示
   ===================================================== */
const DEFAULT_GROUPS = [
  { key: 'pinned', name: '置顶', system: true, keepEmpty: false },
  { key: 'other', name: '其他', system: true, keepEmpty: false },
]
let groupDefs = DEFAULT_GROUPS.map((group) => ({ ...group }))
let groupSeq = 0
let openGroupMenuKey = null
let renamingGroupKey = null

/** 对话所属分组：置顶优先，其次显式指定，最后回落到「其他」。
    置顶优先可保证「置顶/取消置顶」与分组显示永远一致，不会两处数据打架。 */
function groupKeyOf(c) {
  if (c.pinned) return 'pinned'
  if (c.groupId && groupDefs.some((g) => g.key === c.groupId)) return c.groupId
  return 'other'
}
let renamingGroupValue = ''

/* =====================================================
   工具：toast / 转义
   ===================================================== */
const TOAST_ICONS = {
  success: '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
  error:   '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>',
  info:    '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8h.01M11 12h1v4h1"/></svg>',
}
let toastTimer = null

/** 主内容区（.content）当前可见部分的矩形，用于把浮层居中到该区域 */
function contentVisibleRect() {
  const el = document.querySelector('.content')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const top = Math.max(r.top, 0)
  const bottom = Math.min(r.bottom, window.innerHeight)
  const left = Math.max(r.left, 0)
  const right = Math.min(r.right, window.innerWidth)
  return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) }
}
/** 把 fixed 浮层铺到主内容区可见矩形上（内部 flex center 自然居中） */
function fitOverlayToContent(layer) {
  if (!layer) return
  const r = contentVisibleRect()
  if (!r) return
  layer.style.top = r.top + 'px'
  layer.style.left = r.left + 'px'
  layer.style.width = r.width + 'px'
  layer.style.height = r.height + 'px'
}

function showToast(message, type = 'info') {
  const layer = document.getElementById('toastLayer')
  const iconEl = document.getElementById('toastIcon')
  const textEl = document.getElementById('toastText')
  if (!layer) return
  fitOverlayToContent(layer)
  layer.style.zIndex = document.querySelector('.modal-layer') ? '600' : ''
  iconEl.className = `toast-icon ${type}`
  iconEl.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info
  textEl.textContent = type === 'error' && window.ByImageI18n ? ByImageI18n.message(message) : message
  layer.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => layer.classList.remove('show'), 1800)
}
function hideToast() {
  clearTimeout(toastTimer)
  document.getElementById('toastLayer')?.classList.remove('show')
}

/* 居中确认对话框（替代原生 confirm） */
function askConfirm({ title, desc, confirmText = () => tr('确定'), danger = true }) {
  return new Promise((resolve) => {
    const text = (value) => typeof value === 'function' ? value() : value
    const root = document.getElementById('confirmRoot')
    root.innerHTML = `
      <div class="confirm-layer">
        <div class="confirm-card">
          <div class="confirm-title">${escapeHtml(text(title))}</div>
          <div class="confirm-desc">${escapeHtml(text(desc))}</div>
          <div class="confirm-actions">
            <button class="confirm-btn" data-act="cancel" data-i18n="取消">${escapeHtml(tr("取消"))}</button>
            <button class="confirm-btn ${danger ? 'danger' : ''}" data-act="ok">${escapeHtml(text(confirmText))}</button>
          </div>
        </div>
      </div>`
    const layer = root.querySelector('.confirm-layer')
    const translate = () => {
      root.querySelector('.confirm-title').textContent = text(title)
      root.querySelector('.confirm-desc').textContent = text(desc)
      root.querySelector('[data-act="ok"]').textContent = text(confirmText)
    }
    window.addEventListener('byimage:languagechange', translate)
    fitOverlayToContent(layer)
    if (document.querySelector('.modal-layer')) layer.style.zIndex = '600'
    requestAnimationFrame(() => layer.classList.add('show'))
    const close = (v) => {
      window.removeEventListener('byimage:languagechange', translate)
      document.removeEventListener('keydown', onKey)
      layer.classList.remove('show')
      setTimeout(() => { root.innerHTML = '' }, 200)
      resolve(v)
    }
    root.querySelector('[data-act="cancel"]').onclick = () => close(false)
    root.querySelector('[data-act="ok"]').onclick = () => close(true)
    layer.onclick = (e) => { if (e.target === layer) close(false) }
    const onKey = (e) => {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false) }
      if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); close(true) }
    }
    document.addEventListener('keydown', onKey)
  })
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))
}

function conversationTitle(c) {
  if (!c) return tr('新对话')
  const example = DEFAULT_CONVERSATIONS.find((item) => item.id === c.exampleId)
  if (example && c.title === example.title) return tr(example.title)
  if (c.autoTitle || (c.autoTitle == null && c.title === '新对话' && !conversationRounds(c).length)) return tr('新对话')
  return c.title
}
function groupName(g) {
  const original = DEFAULT_GROUPS.find((item) => item.key === g.key)
  return original && original.name === g.name && !g.renamed ? tr(g.name) : g.name
}
function conversationDate(c) {
  return c.date === '今天' || c.date === 'Today' ? tr('今天') : c.date
}
function durationLabel(value) {
  const seconds = /^(\d+(?:\.\d+)?)\s*(?:秒|s)$/.exec(value)
  return seconds ? tr('{0} 秒', seconds[1]) : value
}

/* =====================================================
   渲染：对话列表（带搜索过滤）
   ===================================================== */
function renderList() {
  const list = document.getElementById('convList')
  const q = searchQuery.trim().toLowerCase()

  /* 搜索同时匹配「对话标题」和「分组名」：
     分组名命中时整组展示（哪怕组内暂时没有对话），否则只展示标题命中的对话 */
  const sections = groupDefs.map((g) => {
    const nameHit = !!q && groupName(g).toLowerCase().includes(q)
    const items = q
      ? conversations.filter((c) => groupKeyOf(c) === g.key && (nameHit || conversationTitle(c).toLowerCase().includes(q) || c.title.toLowerCase().includes(q)))
      : conversations.filter((c) => groupKeyOf(c) === g.key)
    return { g, items: items.sort((a, b) => b.createdAt - a.createdAt), nameHit }
  })

  // 有搜索词但既没有对话命中、也没有分组名命中 → 空状态
  if (q && !sections.some((s) => s.items.length || s.nameHit)) {
    list.innerHTML = `
      <div class="search-empty fade-in">
        <div class="ic">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        </div>
        <div>${escapeHtml(tr("没有匹配「{0}」的对话或分组", q))}</div>
      </div>`
    return
  }

  // 分组名命中 / 组内还有对话 / 无搜索词时的自建空分组 → 才渲染该分组
  const groups = sections.filter((s) => s.items.length || s.nameHit || (!q && s.g.keepEmpty))

  const renderItem = (c) => {
    if (renamingId === c.id) {
      return `<div class="conv-item ${c.active ? 'is-active' : ''}" data-id="${c.id}">
        ${c.pinned ? pinSvg() : ''}
        <input class="conv-rename-input" data-rename="${c.id}" value="${escapeHtml(renamingValue)}" />
      </div>`
    }
    if (multiMode) {
      const on = multiSelected.has(c.id)
      return `<div class="conv-item is-multi ${on ? 'is-checked' : ''}" data-id="${c.id}">
        <span class="multi-check ${on ? 'is-on' : ''}" data-check="${c.id}" role="checkbox" aria-checked="${on}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3.2" d="M5 13l4 4L19 7"/></svg>
        </span>
        <button type="button" class="conv-body" data-id="${c.id}">
          <span class="conv-title">${escapeHtml(conversationTitle(c))}</span>
          <span class="conv-date">${escapeHtml(conversationDate(c))}</span>
        </button>
      </div>`
    }
    return `<div class="conv-item ${c.active ? 'is-active' : ''}" data-id="${c.id}">
      ${c.pinned ? pinSvg() : ''}
      <button type="button" class="conv-body" data-id="${c.id}" aria-current="${c.id === activeId}">
        <span class="conv-title">${escapeHtml(conversationTitle(c))}</span>
        <span class="conv-date">${escapeHtml(conversationDate(c))}</span>
      </button>
      <button class="more-btn ${openMenuId === c.id ? 'is-open' : ''}" data-more="${c.id}" title="${escapeHtml(tr("更多"))}" data-i18n-title="更多">···</button>
      <div class="menu fade-in-menu" data-menu="${c.id}" style="${openMenuId === c.id ? '' : 'display:none'}">${menuHtml(c)}</div>
    </div>`
  }

  list.innerHTML = groups
    .map((s) => groupLabelHtml(s.g) + (s.items.length
      ? s.items.map(renderItem).join('')
      : `<div class="conv-group-empty">${escapeHtml(tr("暂无对话"))}</div>`))
    .join('')

  if (renamingGroupKey != null) {
    const gInput = list.querySelector(`[data-grename="${renamingGroupKey}"]`)
    if (gInput) { gInput.focus(); gInput.select() }
  }
  if (renamingId != null) {
    const input = list.querySelector(`[data-rename="${renamingId}"]`)
    if (input) { input.focus(); input.select() }
  }
}

/** 分组标题：普通态带「···」菜单（重命名 / 删除），双击标题也能重命名，编辑态渲染输入框 */
function groupLabelHtml(g) {
  const k = escapeHtml(g.key)
  if (renamingGroupKey === g.key) {
    return `<div class="conv-group-label is-editing"><input class="group-rename-input" data-grename="${k}" value="${escapeHtml(renamingGroupValue)}" /></div>`
  }
  const open = openGroupMenuKey === g.key
  return `<div class="conv-group-label" data-group="${k}" title="${escapeHtml(tr("双击可重命名分组"))}" data-i18n-title="双击可重命名分组">
    <span class="cgl-name">${escapeHtml(groupName(g))}</span>
    <button class="more-btn cgl-more ${open ? 'is-open' : ''}" data-gmore="${k}" title="${escapeHtml(tr("更多"))}" data-i18n-title="更多" aria-label="${escapeHtml(tr("分组操作"))}" data-i18n-aria-label="分组操作">···</button>
    <div class="menu cgl-menu fade-in-menu" data-gmenu="${k}" style="${open ? '' : 'display:none'}">${groupMenuHtml(g)}</div>
  </div>`
}

/** 分组「···」菜单：重命名 + 删除分组 */
function groupMenuHtml(g) {
  return `
    <button class="menu-item" data-gact="rename" data-key="${escapeHtml(g.key)}">${svgIcon('M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z')}<span>${escapeHtml(tr("重命名"))}</span></button>
    <div class="menu-sep"></div>
    <button class="menu-item danger" data-gact="delete" data-key="${escapeHtml(g.key)}">${svgIcon('M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16')}<span>${escapeHtml(tr("删除分组"))}</span></button>`
}

function handleGroupAction(act, key) {
  openGroupMenuKey = null
  if (act === 'rename') {
    startGroupRename(key)
    return
  }
  if (act === 'delete') {
    deleteGroup(key)
    return
  }
  renderList()
}

/** 删除分组：组内对话迁移到剩余分组，至少保留一个分组 */
async function deleteGroup(key) {
  const g = groupDefs.find((x) => x.key === key)
  if (!g) return
  if (groupDefs.length <= 1) {
    showToast(tr("至少保留一个分组"), 'info')
    renderList()
    return
  }
  const affected = conversations.filter((c) => groupKeyOf(c) === key).length
  const rest = groupDefs.filter((x) => x.key !== key)
  const target = rest.find((x) => x.key === 'other') || rest[0]
  const ok = await askConfirm({
    title: () => tr("删除分组"),
    desc: () => tr("删除「{0}」后，该组的 {1} 个对话将移到「{2}」。确定吗？", groupName(g), affected, groupName(target)),
    confirmText: () => tr("删除"),
  })
  if (!ok) { renderList(); return }

  conversations.forEach((c) => {
    if (groupKeyOf(c) !== key) return
    c.pinned = target.key === 'pinned'
    c.groupId = target.key
  })
  groupDefs = rest
  persistConversations()
  showToast(tr("已删除分组「{0}」", groupName(g)), 'success')
  renderList()
}

/** 新建分组：追加到末尾并立即进入命名状态 */
function createGroup() {
  groupSeq += 1
  const key = 'g' + crypto.randomUUID()
  groupDefs.push({ key, name: tr('新分组'), system: false, keepEmpty: true })
  persistConversations()
  startGroupRename(key)
}

function startGroupRename(key) {
  const g = groupDefs.find((x) => x.key === key)
  if (!g) return
  renamingGroupKey = key
  renamingGroupValue = groupName(g)
  renderList()
}

function commitGroupName(value) {
  const v = (value || '').trim()
  const g = groupDefs.find((x) => x.key === renamingGroupKey)
  if (v && g && v !== g.name) {
    g.name = v
    g.renamed = true
    showToast(tr("分组已重命名"), 'success')
  }
  renamingGroupKey = null
  persistConversations()
  renderList()
}

function cancelGroupRename() {
  renamingGroupKey = null
  renderList()
}
function pinSvg() {
  return `<span class="conv-pin"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3-7 3V5z"/></svg></span>`
}

/* =====================================================
   多选模式
   ===================================================== */
let multiMode = false
const multiSelected = new Set()

function enterMultiMode(id) {
  multiMode = true
  multiSelected.clear()
  if (id != null) multiSelected.add(id)
  openMenuId = null
  renamingId = null
  renderList()
  renderMultiBar()
}
function exitMultiMode() {
  multiMode = false
  multiSelected.clear()
  renderList()
  renderMultiBar()
}
function toggleMultiSelect(id) {
  if (multiSelected.has(id)) multiSelected.delete(id)
  else multiSelected.add(id)
  renderList()
  renderMultiBar()
}
function toggleSelectAllMulti() {
  const ids = conversations.map((c) => c.id)
  const allOn = ids.length > 0 && ids.every((i) => multiSelected.has(i))
  multiSelected.clear()
  if (!allOn) ids.forEach((i) => multiSelected.add(i))
  renderList()
  renderMultiBar()
}
function renderMultiBar() {
  const el = document.getElementById('multiBar')
  if (!el) return
  if (!multiMode) { el.hidden = true; el.innerHTML = ''; return }
  const n = multiSelected.size
  const allOn = conversations.length > 0 && n === conversations.length
  el.hidden = false
  el.innerHTML = `
    <div class="multi-bar">
      <span class="mb-count">${escapeHtml(tr("已选择"))} <b>${n}</b> ${escapeHtml(tr("个对话"))}</span>
      <button class="mb-btn" data-mb="all">${allOn ? tr("取消全选") : tr("全选")}</button>
      <button class="mb-btn danger" data-mb="delete" ${n === 0 ? 'disabled' : ''}>${escapeHtml(tr("删除"))}</button>
    </div>`
}
document.getElementById('multiBar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-mb]')
  if (!btn) return
  const act = btn.dataset.mb
  if (act === 'all') toggleSelectAllMulti()
  else if (act === 'cancel') exitMultiMode()
  else if (act === 'delete') deleteMultiSelected()
})
/* 多选状态下，双击对话列表的空白处 → 退出多选 */
document.getElementById('convList').addEventListener('dblclick', (e) => {
  // 双击分组名 → 重命名（点在「···」上不算）
  if (e.target.closest('.more-btn')) return
  const label = e.target.closest('.conv-group-label')
  if (label && !label.classList.contains('is-editing')) {
    e.preventDefault()
    startGroupRename(label.dataset.group)
    return
  }
  if (!multiMode) return
  if (e.target.closest('.conv-item')) return   // 点在条目上不算空白
  exitMultiMode()
  showToast(tr("已退出多选"), 'info')
})
async function deleteMultiSelected() {
  const n = multiSelected.size
  if (!n) return
  const ok = await askConfirm({
    title: () => tr("删除对话"),
    desc: () => tr("确定要删除选中的 {0} 个对话吗？这些对话的记录将从本地移除，此操作不可撤销。", n),
    confirmText: () => tr("删除"),
  })
  if (!ok) return
  conversations = conversations.filter((c) => !multiSelected.has(c.id))
  if (activeId != null && multiSelected.has(activeId)) {
    activeId = conversations.length ? conversations[0].id : null
    renderChatView()
  }
  await persistConversations()
  showToast(tr("已删除 {0} 个对话", n), 'success')
  exitMultiMode()
}

/* =====================================================
   菜单项
   ===================================================== */
const MENU = [
  { key: 'rename',  label: '重命名',  icon: svgIcon('M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z') },
  { key: 'pin',     label: '置顶',    icon: svgIcon('M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3-7 3V5z') },
  { key: 'multi',   label: '多选',    icon: svgIcon('M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11') },
  { sep: true },
  { key: 'group',   label: '归类分组', icon: svgIcon('M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z') },
  { key: 'delete',  label: '删除',    icon: svgIcon('M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'), danger: true },
]
function svgIcon(d) {
  return `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${d}"/></svg>`
}
function menuHtml(c) {
  return MENU.map((m) => {
    if (m.sep) return '<div class="menu-sep"></div>'
    const label = m.key === 'pin' && c.pinned ? tr("取消置顶") : tr(m.label)
    // 「归类分组」展开成二级列表（手风琴式，不做右侧浮层，避免被侧边栏裁切）
    if (m.key === 'group') {
      const current = groupKeyOf(c)
      const opts = groupDefs.map((g) => `
        <button class="menu-sub-item ${g.key === current ? 'is-current' : ''}" data-act="movegroup" data-id="${c.id}" data-key="${escapeHtml(g.key)}">
          <span class="msi-name">${escapeHtml(groupName(g))}</span>
          ${g.key === current ? '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
        </button>`).join('')
      return `<div class="menu-group-wrap">
        <button class="menu-item has-sub" data-act="togglegroup" data-id="${c.id}">${m.icon}<span>${label}</span>
          <svg class="mi-caret" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M9 6l6 6-6 6"/></svg>
        </button>
        <div class="menu-sub" data-sub="${c.id}" style="display:none">${opts}</div>
      </div>`
    }
    return `<button class="menu-item ${m.danger ? 'danger' : ''}" data-act="${m.key}" data-id="${c.id}">${m.icon}<span>${label}</span></button>`
  }).join('')
}

/** 把对话归类到某个分组（置顶分组会同步维护 pinned，避免两处数据不一致） */
function setConversationGroup(id, key) {
  const c = conversations.find((x) => x.id === id)
  const g = groupDefs.find((x) => x.key === key)
  if (!c || !g) return
  c.pinned = key === 'pinned'
  c.groupId = key
  openMenuId = null
  persistConversations()
  showToast(tr("已归类到「{0}」", groupName(g)), 'success')
  renderList()
}

/* =====================================================
   侧边栏事件（事件委托）
   ===================================================== */
document.getElementById('convList').addEventListener('click', (e) => {
  // 多选模式：复选框或整行都只切换选中，不进对话
  if (multiMode) {
    const row = e.target.closest('.conv-item')
    if (row) {
      toggleMultiSelect(Number(row.dataset.id))
      return
    }
  }
  // 分组标题的「···」菜单
  const gMore = e.target.closest('[data-gmore]')
  if (gMore) {
    e.stopPropagation()
    openMenuId = null
    openGroupMenuKey = openGroupMenuKey === gMore.dataset.gmore ? null : gMore.dataset.gmore
    renderList()
    return
  }
  const gAct = e.target.closest('[data-gact]')
  if (gAct) {
    e.stopPropagation()
    handleGroupAction(gAct.dataset.gact, gAct.dataset.key)
    return
  }
  const moreBtn = e.target.closest('[data-more]')
  if (moreBtn) {
    e.stopPropagation()
    const id = Number(moreBtn.dataset.more)
    openGroupMenuKey = null
    openMenuId = openMenuId === id ? null : id
    renderList()
    return
  }
  const menuBtn = e.target.closest('[data-act]')
  if (menuBtn) {
    e.stopPropagation()
    const act = menuBtn.dataset.act
    // 归类分组：展开二级列表不动菜单；选中具体分组才真正归类
    if (act === 'togglegroup') {
      const sub = document.querySelector(`[data-sub="${menuBtn.dataset.id}"]`)
      if (sub) {
        const willOpen = sub.style.display === 'none'
        sub.style.display = willOpen ? 'block' : 'none'
        menuBtn.classList.toggle('is-expanded', willOpen)
      }
      return
    }
    if (act === 'movegroup') {
      setConversationGroup(Number(menuBtn.dataset.id), menuBtn.dataset.key)
      return
    }
    handleMenuAction(act, Number(menuBtn.dataset.id))
    return
  }
  if (e.target.closest('input, .menu')) return
  const row = e.target.closest('.conv-item')
  if (row) {
    selectConversation(Number(row.dataset.id))
    return
  }
})
document.getElementById('convList').addEventListener('keydown', (e) => {
  if (!e.target.dataset) return
  // 分组名重命名
  if (e.target.dataset.grename !== undefined) {
    if (e.key === 'Enter') { e.preventDefault(); commitGroupName(e.target.value) }
    if (e.key === 'Escape') { e.preventDefault(); cancelGroupRename() }
    return
  }
  if (!e.target.dataset.rename) return
  if (e.key === 'Enter') commitRename(e.target.value)
  if (e.key === 'Escape') { renamingId = null; renderList() }
})
document.getElementById('convList').addEventListener('focusout', (e) => {
  if (!e.target.dataset) return
  if (e.target.dataset.grename !== undefined) { commitGroupName(e.target.value); return }
  if (e.target.dataset.rename) commitRename(e.target.value)
})
document.addEventListener('click', (e) => {
  const inMenu = e.target.closest('.menu') || e.target.closest('.more-btn')
  if (inMenu) return
  if (openMenuId != null || openGroupMenuKey != null) {
    openMenuId = null
    openGroupMenuKey = null
    renderList()
  }
})

async function handleMenuAction(act, id) {
  const c = conversations.find((x) => x.id === id)
  if (!c) return
  openMenuId = null
  if (act === 'rename') {
    renamingId = id
    renamingValue = conversationTitle(c)
    renderList()
    return
  }
  if (act === 'pin') {
    c.pinned = !c.pinned
    persistConversations()
    showToast(c.pinned ? tr("已置顶：{0}", conversationTitle(c)) : tr("已取消置顶"), 'success')
    renderList()
    return
  }
  if (act === 'share') {   // 分享已移除：数据只在本机，链接对外无效
    showToast(tr("分享功能已移除（数据只保存在本机）"), 'info')
    renderList()
    return
  }
  if (act === 'multi') {
    enterMultiMode(id)   // 进入多选，并默认勾选触发的那一条
    return
  }
  if (act === 'delete') {
    const ok = await askConfirm({
      title: () => tr("删除对话"),
      desc: () => tr("确定要删除「{0}」吗？该对话的记录将从本地移除，此操作不可撤销。", conversationTitle(c)),
      confirmText: () => tr("删除"),
    })
    if (!ok) { renderList(); return }
    conversations = conversations.filter((x) => x.id !== id)
    if (activeId === id) {
      const next = conversations[0]
      activeId = next ? next.id : null
      syncTitle()
      renderChatView()
    }
    await persistConversations()
    showToast(tr("对话已删除"), 'success')
    renderList()
    return
  }
}
function commitRename(value) {
  const v = value.trim()
  if (v && renamingId != null) {
    const c = conversations.find((x) => x.id === renamingId)
    if (c) {
      c.title = v
      c.autoTitle = false
      if (c.id === activeId) syncTitle()
      showToast(tr("已重命名"), 'success')
    }
  }
  renamingId = null
  renderingViaRename = false
  persistConversations()
  renderList()
}
function selectConversation(id) {
  if (!conversations.some((c) => c.id === id)) return
  const changed = activeId !== id
  activeId = id
  conversations.forEach((c) => (c.active = c.id === id))
  const hadMenu = openMenuId != null || openGroupMenuKey != null
  openMenuId = null
  openGroupMenuKey = null
  syncTitle()
  // 普通切换只更新选中态，保留列表节点、焦点和滚动位置。
  if (hadMenu) renderList()
  else document.querySelectorAll('#convList .conv-item').forEach((row) => {
    const selected = Number(row.dataset.id) === id
    row.classList.toggle('is-active', selected)
    row.querySelector('.conv-body')?.setAttribute('aria-current', String(selected))
  })
  stickBottom()
  if (changed) renderChatView()
  else scrollChatToBottom(false)
  persistActiveConversation()
}
function handleNewConversation() {
  const bytes = crypto.getRandomValues(new Uint32Array(2))
  const id = (bytes[0] & 0x1fffff) * 0x100000000 + bytes[1]
  const c = { id, title: '新对话', autoTitle: true, date: '今天', createdAt: Date.now(), pinned: false, active: true }
  conversations.forEach((x) => (x.active = false))
  conversations.unshift(c)
  activeId = c.id
  syncTitle()
  renderList()
  renderChatView()
  persistConversations()
  showToast(tr("已开启新对话"), 'success')
  promptInput.focus({ preventScroll: true })
}

/* =====================================================
   搜索
   ===================================================== */
const searchInput = document.getElementById('searchInput')
const searchWrap = document.getElementById('searchWrap')
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value
  searchWrap.classList.toggle('has-value', !!searchQuery)
  renderList()
})
function clearSearch() {
  searchInput.value = ''
  searchQuery = ''
  searchWrap.classList.remove('has-value')
  renderList()
  searchInput.focus()
}

/* =====================================================
   主区标题编辑
   ===================================================== */
function syncTitle() {
  const c = conversations.find((x) => x.id === activeId)
  const title = document.getElementById('mainTitle')
  if (title) title.textContent = conversationTitle(c)
}

/* =====================================================
   对话详情：渲染提示词 + 生成结果
   ===================================================== */
const ICON_DOWNLOAD = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>'
const ICON_COPY = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>'
const ICON_RETRY = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>'

/** 已发送提示词支持 Markdown 排版，代码块里的参数示例保持原样。 */
function renderPromptHtml(text) {
  if (!window.ByChatFormat) return escapeHtml(text)
  return window.ByChatFormat.renderMarkdown(text, {
    renderArgument: (name, value, index) => `<span class="arg-chip" data-argument-index="${index}" data-name="${escapeHtml(name)}" data-value="${escapeHtml(value)}" title="${escapeHtml(tr("点击修改「{0}」", name))}" onclick="editArgument(event, this)"><span class="arg-name">${escapeHtml(name)}</span><span class="arg-value">${escapeHtml(value)}</span></span>`,
  })
}
function editArgument(e, el) {
  e.stopPropagation()
  if (el.querySelector('input')) return
  const name = el.dataset.name
  const cur = el.dataset.value || ''
  el.innerHTML = `<input class="arg-input" value="${escapeHtml(cur)}" />`
  const input = el.querySelector('input')
  input.focus(); input.select()
  let done = false
  const finish = (save) => {
    if (done) return
    done = true
    const v = save ? input.value.trim() : cur
    el.dataset.value = v || cur
    el.innerHTML = `<span class="arg-name">${escapeHtml(name)}</span><span class="arg-value">${escapeHtml(el.dataset.value)}</span>`
  }
  input.addEventListener('blur', () => finish(true))
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true) }
    if (ev.key === 'Escape') { ev.preventDefault(); finish(false) }
  })
}
/* ===== 图片寻址 =====
   会话里只存 IndexedDB 的图片 id（形如 img_xxx），**不存 blob: 临时地址** ——
   那种地址刷新页面就失效，历史图片会全部变成裂图。展示前再换成本次可用的 URL。 */
const IMAGE_URLS = new Map()   // id -> objectURL，会话内缓存，避免反复读库
const IMAGE_REQUESTS = new Map() // 同一张图片共用读取请求，不阻塞新对话

/** 会话里的 images 既可能是图片 id，也可能是原型自带的静态示例路径 */
function isImageId(src) {
  return typeof src === 'string' && src.startsWith('img_')
}

/** 把 id / 静态路径统一成能塞进 <img src> 的地址；id 尚未取到时返回 '' */
function imageSrcOf(src) {
  if (!src) return ''
  return isImageId(src) ? (IMAGE_URLS.get(src) || '') : src
}

/** id -> URL（必要时回 IndexedDB 取） */
async function resolveImageSrc(src) {
  if (!isImageId(src)) return src || ''
  if (IMAGE_URLS.has(src)) return IMAGE_URLS.get(src)
  if (!window.ByChatDB) return ''
  if (!IMAGE_REQUESTS.has(src)) {
    const request = Promise.resolve()
      .then(() => window.ByChatDB.imageUrl(src))
      .then((url) => {
        if (url) IMAGE_URLS.set(src, url)
        return url || ''
      })
      .catch(() => '')
      .finally(() => IMAGE_REQUESTS.delete(src))
    IMAGE_REQUESTS.set(src, request)
  }
  return IMAGE_REQUESTS.get(src)
}

/** 重绘之后补齐：把还没取到地址的 id 从 IndexedDB 读出来，原地填进 <img> */
async function hydrateImages() {
  if (!window.ByChatDB) return
  const pending = Array.from(document.querySelectorAll('#chatView .msg-img.is-loading[data-img-id]'))
  await Promise.all(pending.map(async (box) => {
    const url = await resolveImageSrc(box.dataset.imgId)
    // 切换前的旧节点可能已被移除，读取结果只填回仍显示的节点。
    if (!box.isConnected) return
    const img = box.querySelector('img')
    if (url && img) {
      img.src = url
      box.classList.remove('is-loading')
    } else if (img) {
      onChatImageError(img)
    }
  }))
}

/** 标记当前任务；kind 区分图片生成与文本回复，决定内容和停止按钮文案。 */
function setRunningRound(c, round, kind) {
  const idx = round ? conversationRounds(c).indexOf(round) : -1
  runningRoundKey = c && idx >= 0 ? `${c.id}:${idx}` : null
  if (kind) runningRoundKind = kind
}
function clearRunningRound() {
  if (streamRenderFrame != null) cancelAnimationFrame(streamRenderFrame)
  streamRenderFrame = null
  runningRoundKey = null
  streamingText = ''
  streamingReasoning = ''
}

/** 用量：后端 summarize_usage 已经算好了，以前前端根本没显示。
 *  字段缺失时保持 None，这里也不编造 —— 没有就不显示。 */
function usageText(u) {
  if (!u) return ''
  const parts = []
  if (u.input_tokens != null) parts.push(tr("输入 {0}", u.input_tokens))
  if (u.output_tokens != null) parts.push(tr("输出 {0}", u.output_tokens))
  if (u.cache_read_tokens != null) parts.push(tr("缓存命中 {0}", u.cache_read_tokens))
  if (!parts.length) return ''
  return `<span class="msg-usage">${escapeHtml(parts.join(' · '))} tokens</span>`
}

/** 推理过程（可折叠）。后端三种协议都会推 reasoning 事件，以前全被丢掉了。
 *  idx 用来给容器定 id，流式时才能定点更新而不整页重绘。 */
function reasoningBlock(idx, text) {
  return `<details class="msg-reasoning" id="reasoning-${idx}"${text ? '' : ' hidden'}>
      <summary>${escapeHtml(tr("推理过程"))}</summary>
      <div class="msg-reasoning-body">${escapeHtml(text || '')}</div>
    </details>`
}

/** 生成中占位：大转圈 + 标题 + 说明。图片生成一直用这套视觉，
 *  聊天在拿到第一个字/推理前也用同一套，保持"生成中"观感统一。 */
function pendingBlock(title, subtitle) {
  return `<div class="msg-pending" role="status"><span class="spinner is-big" aria-hidden="true"></span><div><strong>${title}</strong><span class="msg-pending-text">${subtitle}</span></div></div>`
}

/**
 * 只把新收到的字追加进当前气泡，不整页重绘。
 * 整页重绘会打断用户的滚动位置，也会让光标闪烁重置。
 */
function updateStreamingBubble() {
  if (!runningRoundKey || !runningRoundKey.startsWith(`${activeId}:`)) return
  if (streamRenderFrame != null) return
  const key = runningRoundKey
  streamRenderFrame = requestAnimationFrame(() => {
    streamRenderFrame = null
    if (runningRoundKey === key && key.startsWith(`${activeId}:`)) paintStreamingBubble()
  })
}

function paintStreamingBubble() {
  const idx = runningRoundKey ? Number(String(runningRoundKey).split(':')[1]) : -1
  if (idx < 0) return

  // 恢复对话或切换任务类型后，容器缺失时先补齐，再定点更新正文。
  if (!document.getElementById(`stream-${idx}`)) {
    renderChatView()
    if (stickToBottom) scrollChatToBottom(false)
  }

  const box = document.getElementById(`stream-${idx}`)
  if (box) box.innerHTML = assistantText(streamingText) + '<span class="caret" aria-hidden="true"></span>'

  const rWrap = document.getElementById(`reasoning-${idx}`)
  const rBody = rWrap && rWrap.querySelector('.msg-reasoning-body')
  if (rBody) {
    rBody.textContent = streamingReasoning
    rWrap.hidden = !streamingReasoning
  }
  if (document.getElementById('chatSearchInput')?.value.trim()) applyChatSearch(false)
  if (stickToBottom) scrollChatToBottom(false)
}

/**
 * 文本模型该走哪套协议（后端三个端点：/responses、/messages、/chat/completions）。
 *
 *   claude-*  → /v1/messages        （Anthropic 原生协议）
 *   gpt-*     → /v1/responses       （OpenAI 新版协议）
 *   其他       → auto：先试 /responses，没吐出内容就回退 /chat/completions
 */
const CHAT_MODE_KEY = 'bychat.chatMode'

/** 设置里没有这个选项（前端要照抄原型、不能自创 UI），
 *  所以留一个手动覆盖口子：localStorage 里写 bychat.chatMode，
 *  或临时在地址后加 ?chatMode=chat_completions 访问一次即可。
 *  可选值：auto / responses / chat_completions / messages。 */
function chatModeOverride() {
  try {
    const qs = new URLSearchParams(location.search).get('chatMode')
    if (qs) { localStorage.setItem(CHAT_MODE_KEY, qs); return qs }
    return localStorage.getItem(CHAT_MODE_KEY) || ''
  } catch { return '' }
}

function chatModeFor(model) {
  const forced = chatModeOverride()
  if (forced) return forced

  const id = String(model || '').toLowerCase()
  if (id.includes('claude')) return 'messages'
  // 其余一律交给后端的 auto：它先试 /responses，没吐出任何内容时自动回退
  // /chat/completions。上游哪个口通是会变的，硬编码模型名→协议迟早会踩坑
  // （本项目就踩过一次：把 gpt 写死走 /chat/completions，而该上游这个口是 502）。
  return 'auto'
}

/**
 * 拼出要发给上游的对话历史。
 *
 * 只发当前这一句的话，模型是「没有记忆」的：问「我刚才说了什么」它答不上来。
 * 规则跟 legacy 脚本一致：
 *   - 只取这一轮**之前**的对话（当前这轮还没答，不能算进去）
 *   - 跳过失败的和只出了图的轮次 —— 它们的 prompt 是生图描述，混进上下文会带偏
 *   - 最多带最近 20 轮，避免上下文越滚越大、token 越花越多
 *
 * images 是本轮附带的参考图（data URL）。选了文本模型时它不会走生图接口，
 * 而是作为多模态内容挂在当前这句上一起发出去，让模型「看着图回答」。
 */
function chatHistory(c, round, prompt, images = []) {
  const rounds = Array.isArray(c && c.messages) ? c.messages : []
  const upto = rounds.indexOf(round)
  const before = upto === -1 ? rounds : rounds.slice(0, upto)

  const out = []
  for (const r of before.slice(-20)) {
    if (!r || !r.text) continue        // 失败 / 只出图的轮次不进上下文
    if (r.prompt) out.push({ role: 'user', content: r.prompt })
    out.push({ role: 'assistant', content: r.text })
  }
  const refs = (images || []).filter((src) => typeof src === 'string' && src.startsWith('data:'))
  out.push(refs.length
    ? { role: 'user', content: [{ type: 'text', text: prompt }, ...refs.map((image) => ({ type: 'image', image }))] }
    : { role: 'user', content: prompt })
  return out
}

/** 把参考图统一成 data URL。上传的可能是 blob: 或 IndexedDB 里的引用。 */
async function refsToDataUrls(refs, signal) {
  const out = []
  for (const ref of (refs || []).slice(0, MAX_INPUT_IMAGES)) {
    if (signal) signal.throwIfAborted()
    if (typeof ref === 'string' && ref.startsWith('data:')) { out.push(ref); continue }
    const src = await resolveImageSrc(ref)
    if (!src) throw new Error(tr("无法读取参考图，请重新添加图片"))
    const response = await fetch(src, { signal })
    if (!response.ok) throw new Error(tr("无法读取参考图，请重新添加图片"))
    out.push(await fileToDataUrl(await response.blob()))
  }
  return out
}

/** 这一轮到底是出图还是纯聊天：决定转圈文案和走哪个接口 */
function taskKindFor(model) {
  return (MODELS.find((m) => m.id === model)?.kind || (/image|dall|flux|midjourney|imagen|seedream/i.test(model) ? 'image' : 'chat')) === 'image' ? 'image' : 'chat'
}

/** 聊天区滚到底部：发出消息 / 收到回复后要看到最新内容 */
function scrollChatToBottom(smooth = true) {
  const box = document.querySelector('.content')
  if (!box) return
  if (smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && typeof box.scrollTo === 'function') {
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
  } else {
    box.scrollTop = box.scrollHeight
  }
  syncLatestButton()
}

function syncLatestButton() {
  const box = document.querySelector('.content')
  const wrap = document.getElementById('chatJumpWrap')
  if (box && wrap) wrap.hidden = box.scrollHeight - box.clientHeight - box.scrollTop < 120
}

function jumpToLatest() {
  clearChatSearch(false)
  stickBottom()
  scrollChatToBottom()
}

/* 打开对话后持续跟随最新内容，包括慢速加载的图片。
   用户主动浏览历史时停止跟随；再次打开对话或发送消息时恢复。 */
let stickToBottom = false
let renderedConversationId
function stickBottom() {
  stickToBottom = true
}
function onChatImageLoaded(img) {
  img.closest('.msg-img')?.classList.remove('is-loading', 'is-unavailable')
  img.closest('.image-result')?.classList.toggle('is-portrait', img.naturalHeight > img.naturalWidth)
  if (stickToBottom && img.isConnected) scrollChatToBottom(false)
  syncLatestButton()
}
function onChatImageError(img) {
  const box = img.closest('.msg-img')
  if (!box || !box.isConnected) return
  box.classList.remove('is-loading')
  box.classList.add('is-unavailable')
  box.setAttribute('aria-label', tr("图片暂时无法显示"))
  if (stickToBottom) scrollChatToBottom(false)
}
document.addEventListener('DOMContentLoaded', () => {
  const box = document.querySelector('.content')
  if (!box) return
  const release = () => { stickToBottom = false }
  box.addEventListener('wheel', release, { passive: true })
  box.addEventListener('touchmove', release, { passive: true })
  box.addEventListener('pointerdown', release, { passive: true })
  box.addEventListener('scroll', syncLatestButton, { passive: true })
  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) release()
  })
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (stickToBottom) scrollChatToBottom(false)
      syncLatestButton()
    })
    observer.observe(document.getElementById('chatView'))
    observer.observe(box)
  }
})

const expandedPrompts = new Set()

function assistantText(text) {
  return window.ByChatFormat ? window.ByChatFormat.renderMarkdown(text) : escapeHtml(text)
}

function toggleMessagePrompt(roundIdx, button) {
  const key = `${activeId}:${roundIdx}`
  const card = button.closest('.prompt-card')
  const expanded = !expandedPrompts.has(key)
  if (expanded) expandedPrompts.add(key)
  else expandedPrompts.delete(key)
  stickToBottom = false
  card.classList.toggle('is-expanded', expanded)
  button.setAttribute('aria-expanded', String(expanded))
  button.textContent = expanded ? tr("收起") : tr("展开全文")
  syncLatestButton()
}

function renderChatView() {
  const view = document.getElementById('chatView')
  const empty = document.querySelector('.empty')
  if (!view) return
  const changed = renderedConversationId !== activeId
  const openDetails = changed ? [] : Array.from(view.querySelectorAll('details[open][id]'), (el) => el.id)
  if (changed) {
    renderedConversationId = activeId
    const search = document.getElementById('chatSearchInput')
    if (search) search.value = ''
    syncChatSearchWrap()
    stickBottom()
  }
  const c = conversations.find((x) => x.id === activeId)
  const rounds = conversationRounds(c)

  if (!c || rounds.length === 0) {
    view.hidden = true
    view.innerHTML = ''
    if (empty) empty.style.display = ''
    syncLatestButton()
    return
  }
  if (empty) empty.style.display = 'none'
  view.hidden = false

  view.innerHTML = rounds.map((m, i) => {
    const running = runningRoundKey === `${c.id}:${i}`
    const isChatWait = runningRoundKind === 'chat'
    const images = m.images || []
    const prompt = String(m.prompt || '')
    const collapsible = prompt.length > 320 || prompt.split('\n').length > 5
    const expanded = expandedPrompts.has(`${c.id}:${i}`)
    const imgs = images.map((src, j) => {
      const url = imageSrcOf(src)
      return `<figure class="image-result">
        <button class="msg-img${url ? '' : ' is-loading'}" type="button"${isImageId(src) ? ` data-img-id="${escapeHtml(src)}"` : ''} onclick="openLightboxFromEl(this)" aria-label="${escapeHtml(tr("放大查看第 {0} 张图片", j + 1))}">
          <img${url ? ` src="${escapeHtml(url)}"` : ''} alt="${escapeHtml(tr("{0} · 第 {1} 张", conversationTitle(c), j + 1))}" loading="${i === rounds.length - 1 ? 'eager' : 'lazy'}" onload="onChatImageLoaded(this)" onerror="onChatImageError(this)" />
          ${images.length > 1 ? `<span class="image-number">${j + 1} / ${images.length}</span>` : ''}
          <span class="image-zoom" aria-hidden="true">${svgIcon('M10 4a6 6 0 100 12 6 6 0 000-12zM15 15l5 5M7 10h6M10 7v6')}</span>
        </button>
        <figcaption class="image-actions">
          <button class="msg-act" type="button" onclick="downloadCurrentImage(${i}, ${j})">${ICON_DOWNLOAD}${escapeHtml(tr("下载原图"))}</button>
          <button class="msg-act" type="button" onclick="useResultAsReference(${i}, ${j}, this)">${svgIcon('M12 5v14M5 12h14')}${escapeHtml(tr("作为参考图"))}</button>
          <button class="msg-act" type="button" onclick="retryRound(${i})" title="${escapeHtml(tr("使用本轮提示词再次生成"))}" data-i18n-title="使用本轮提示词再次生成">${ICON_RETRY}${escapeHtml(tr("再次生成"))}</button>
        </figcaption>
      </figure>`
    }).join('')

    const resultMeta = [
      m.cancelled ? tr("已停止") : m.error ? tr("未完成") : '',
      m.params?.model || '',
      m.duration ? tr("用时 {0}", durationLabel(m.duration)) : '',
    ].filter(Boolean)
    const status = running
      ? `<button class="msg-act" type="button" onclick="cancelGeneration(this)">${svgIcon('M7 7h10v10H7z')}${escapeHtml(tr(isChatWait ? '停止回复' : '停止生成'))}</button>`
      : `<span class="msg-result-label">${resultMeta.length ? resultMeta.map(escapeHtml).join(' · ') : images.length ? tr("图片已生成") : tr("回复")}</span>`
    let aiInner
    if (running) {
      // 聊天在拿到第一个字/推理片段之前，跟生图一样先看大转圈，
      // 不要一上来就是个空气泡加光标——那样太像卡住了。
      const chatWaitingForFirstToken = isChatWait && !streamingText && !streamingReasoning
      aiInner = !isChatWait
        ? pendingBlock(
            m.phase === 'planning' ? tr("正在理解描述与参考图") : tr("正在绘制你的想法"),
            tr("图片完成后会显示在这里，你可以继续浏览对话。"),
          )
        : chatWaitingForFirstToken
          ? pendingBlock(tr("等待消息返回"), tr("回复生成后会显示在这里，你可以继续浏览对话。"))
          : `${reasoningBlock(i, streamingReasoning)}<div class="msg-text msg-markdown msg-stream" id="stream-${i}">${assistantText(streamingText)}<span class="caret" aria-hidden="true"></span></div>`
    } else {
      aiInner = `${m.reasoning ? reasoningBlock(i, m.reasoning) : ''}
        ${m.text ? `<div class="msg-text msg-markdown">${assistantText(m.text)}</div>` : ''}
        ${m.error ? `<div class="msg-err" role="alert">${escapeHtml(window.ByImageI18n ? ByImageI18n.message(m.error) : m.error)}</div>` : ''}
        ${m.cancelled && !m.text ? `<p class="msg-stopped">${escapeHtml(tr("已停止本次任务，可重新尝试。"))}</p>` : ''}
        ${imgs ? `<div class="msg-images${images.length > 1 ? ' is-grid' : ''}">${imgs}</div>` : ''}
        ${m.text || !images.length ? `<div class="msg-actions">
          ${m.text ? `<button class="msg-act" type="button" onclick="copyReply(${i})">${ICON_COPY}${escapeHtml(tr("复制回复"))}</button>` : ''}
          ${!images.length ? `<button class="msg-act" type="button" onclick="retryRound(${i})">${ICON_RETRY}${m.error || m.cancelled ? tr("重新尝试") : tr("重新回复")}</button>` : ''}
        </div>` : ''}`
    }

    return `<section class="msg is-me" data-round="${i}" id="round-${i}" aria-label="${escapeHtml(tr("第 {0} 轮提问", i + 1))}">
        <div class="msg-body">
          <div class="msg-meta"><span class="msg-author">${escapeHtml(tr("你"))}</span><time>${escapeHtml(m.sentAt || '')}</time></div>
          <div class="prompt-card${collapsible ? ' is-collapsible' : ''}${expanded ? ' is-expanded' : ''}">
            <div class="msg-text msg-markdown prompt-copy" id="prompt-${i}">${renderPromptHtml(prompt)}</div>
            <div class="prompt-actions">
              ${collapsible ? `<button class="prompt-toggle" type="button" onclick="toggleMessagePrompt(${i}, this)" aria-expanded="${expanded}" aria-controls="prompt-${i}">${expanded ? tr("收起") : tr("展开全文")}</button>` : ''}
              <button class="msg-act" type="button" onclick="copyPrompt(${i})">${ICON_COPY}${escapeHtml(tr("复制提示词"))}</button>
              <button class="msg-act" type="button" onclick="reusePrompt(${i})">${svgIcon('M12 20h9M16.5 3.5a2.1 2.1 0 013 3L9 17l-4 1 1-4z')}${escapeHtml(tr("复用提示词"))}</button>
            </div>
          </div>
        </div>
      </section>
      <section class="msg is-assistant" data-round="${i}" aria-label="${escapeHtml(tr("第 {0} 轮回复", i + 1))}" aria-busy="${running}">
        <div class="msg-body">
          <div class="msg-meta"><span class="msg-avatar is-ai"><img src="assets/logo.png" alt="" /></span><span class="msg-author">${escapeHtml(tr("冰云"))}</span>${status}${!running ? usageText(m.usage) : ''}</div>
          ${aiInner}
        </div>
      </section>`
  }).join('')

  for (const id of openDetails) {
    const detail = document.getElementById(id)
    if (detail) detail.open = true
  }
  hydrateImages()
  applyChatSearch(false)
  if (stickToBottom) scrollChatToBottom(false)
  syncLatestButton()
}
/* =====================================================
   当前对话内搜索（只搜聊天记录，不搜对话列表）
   ===================================================== */
/** 固定搜索框清空后仍留在原位；返回最新消息时不抢输入焦点。 */
function clearChatSearch(focus = true) {
  const input = document.getElementById('chatSearchInput')
  if (input) input.value = ''
  applyChatSearch(false)
  if (focus && input) input.focus()
}
function syncChatSearchWrap() {
  const wrap = document.getElementById('chatSearchWrap')
  const input = document.getElementById('chatSearchInput')
  if (wrap && input) wrap.classList.toggle('has-value', !!input.value)
}
function runChatSearch() {
  applyChatSearch(true)
}

/** 搜索只更新高亮，保留图片节点、展开状态和正在编辑的参数。 */
function applyChatSearch(locate = false) {
  const q = (document.getElementById('chatSearchInput')?.value || '').trim().toLowerCase()
  syncChatSearchWrap()
  const messages = Array.from(document.querySelectorAll('#chatView .msg'))
  const hits = new Set()
  for (const message of messages) {
    const text = Array.from(message.querySelectorAll('.msg-text, .msg-meta, .msg-reasoning-body'), (el) => el.textContent).join(' ').toLowerCase()
    if (!q || text.includes(q)) hits.add(message.dataset.round)
  }
  for (const message of messages) {
    const hit = hits.has(message.dataset.round)
    message.classList.toggle('is-dim', !hit)
    message.querySelector('.prompt-card')?.classList.toggle('is-search-match', !!q && hit)
  }
  highlightChat(q)
  if (locate && q) {
    stickToBottom = false
    const first = document.querySelector('#chatView mark') || messages.find((message) => hits.has(message.dataset.round))
    first?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }
  syncLatestButton()
}
function highlightChat(q) {
  document.querySelectorAll('#chatView mark[data-search-hit]').forEach((mark) => {
    const parent = mark.parentNode
    mark.replaceWith(document.createTextNode(mark.textContent))
    parent.normalize()
  })
  if (!q) return
  // 只处理可见文字，避免搜索 div、class 等词时改坏标签与图片地址。
  document.querySelectorAll('#chatView .msg-text, #chatView .msg-reasoning-body').forEach((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.parentElement.closest('button, input, textarea')) nodes.push(node)
    }
    for (const node of nodes) {
      const text = node.textContent
      const lower = text.toLowerCase()
      if (!lower.includes(q)) continue
      const fragment = document.createDocumentFragment()
      let start = 0, found
      while ((found = lower.indexOf(q, start)) !== -1) {
        fragment.append(document.createTextNode(text.slice(start, found)))
        const mark = document.createElement('mark')
        mark.dataset.searchHit = ''
        mark.textContent = text.slice(found, found + q.length)
        fragment.append(mark)
        start = found + q.length
      }
      fragment.append(document.createTextNode(text.slice(start)))
      node.replaceWith(fragment)
    }
  })
}

/* =====================================================
   历史提问：过往提交过的提示词
   ===================================================== */
function toggleHistoryPanel(e) {
  const panel = document.getElementById('historyPanel')
  if (!panel) return
  if (!panel.hidden) { panel.hidden = true; return }
  renderHistoryPanel()
  // 定位到按钮下方
  const btn = document.getElementById('historyBtn')
  if (btn) {
    const r = btn.getBoundingClientRect()
    const pw = panel.offsetWidth || 420
    panel.style.top = (r.bottom + 8) + 'px'
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 12)) + 'px'
  }
  panel.hidden = false
}
function renderHistoryPanel() {
  const panel = document.getElementById('historyPanel')
  if (!panel) return

  // 只看当前对话
  const c = conversations.find((x) => x.id === activeId)
  if (!c) {
    panel.innerHTML = `<div class="hp-empty">${escapeHtml(tr("请先打开一个对话"))}</div>`
    return
  }
  // list 保留原始轮次顺序，item.idx 就是它在对话里的轮次号
  const list = conversationRounds(c)

  if (list.length === 0) {
    panel.innerHTML = `<div class="hp-empty">${escapeHtml(tr("当前对话还没有提问"))}</div>`
    return
  }

  panel.innerHTML = `<div class="hp-title">${escapeHtml(tr("历史提问 · 当前对话（{0}）", list.length))}</div>` + list.map((h, i) => `
    <button type="button" class="hp-item" data-hp="${i}">
      <span class="hp-item-text">${escapeHtml((h.prompt || '').slice(0, 120))}</span>
      <span class="hp-item-meta">${escapeHtml(tr("第 {0} 轮 · {1}", i + 1, h.sentAt || ''))}</span>
    </button>`).join('')

  panel.querySelectorAll('[data-hp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.hp)
      panel.hidden = true
      // 定位到该轮提问（滚动 + 短暂高亮），而不是把内容填进输入框
      locateRound(idx)
    })
  })
}

/** 滚动到指定轮次的提问并短暂高亮 */
function locateRound(idx) {
  const target = document.getElementById('round-' + idx)
  if (!target) { showToast(tr("未找到该条提问"), 'info'); return }
  stickToBottom = false
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  document.querySelectorAll('#chatView .msg.is-locate').forEach((el) => el.classList.remove('is-locate'))
  target.classList.add('is-locate')
  Array.from(target.parentElement.children)
    .filter((el) => el.dataset && el.dataset.round === String(idx))
    .forEach((el) => el.classList.add('is-locate'))
  setTimeout(() => {
    document.querySelectorAll('#chatView .msg.is-locate').forEach((el) => el.classList.remove('is-locate'))
  }, 1800)
}
/** 点击面板外关闭 */
document.addEventListener('click', (e) => {
  const panel = document.getElementById('historyPanel')
  if (!panel || panel.hidden) return
  if (e.target.closest('#historyPanel') || e.target.closest('#historyBtn')) return
  panel.hidden = true
})

/** 从缩略图元素打开灯箱：图片可能是 IndexedDB id，地址要现取 */
function openLightboxFromEl(el) {
  if (!el) return
  const img = el.querySelector('img')
  const src = (img && (img.currentSrc || img.getAttribute('src'))) || el.dataset.src
  if (src) openLightbox(src)
}

/** 按当前选择的格式导出原始尺寸；上游格式不符时在浏览器转换。 */
async function downloadCurrentImage(roundIdx, imageIdx = 0) {
  const c = conversations.find((x) => x.id === activeId)
  const rounds = conversationRounds(c)
  const m = rounds[roundIdx == null ? rounds.length - 1 : roundIdx]
  if (!m || !m.images || !m.images[imageIdx]) { showToast(tr("该对话没有可下载的图片"), 'info'); return }
  const format = PILL_STATE.format || m.params?.output_format || 'PNG'

  // 存的是 IndexedDB id，先换成真正的地址
  const src = await resolveImageSrc(m.images[imageIdx])
  if (!src) { showToast(tr("图片还在读取中，请稍后再试"), 'info'); return }

  const fileBase = `${c.title || 'image'}${m.images.length > 1 ? `-${imageIdx + 1}` : ''}`
  try {
    const res = await fetch(src)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const { blob, extension } = await ByChatImageExport.convertImage(await res.blob(), format)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileBase}.${extension}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    showToast(tr("已开始下载"), 'success')
  } catch (e) {
    showToast('下载失败：' + (e.message || tr("无法转换图片格式")), 'error')
  }
}
function promptForRound(roundIdx) {
  const c = conversations.find((x) => x.id === activeId)
  if (!c) return ''
  const rounds = conversationRounds(c)
  const m = rounds[roundIdx == null ? rounds.length - 1 : roundIdx]
  if (!m) return ''
  const chips = new Map(Array.from(document.querySelectorAll(`#round-${roundIdx} .arg-chip`), (chip) => [Number(chip.dataset.argumentIndex), chip.dataset.value]))
  let n = 0
  return String(m.prompt || '').replace(/\{argument\s+name="([^"]+)"\s+default="([^"]*)"\}/g, (_, name, value) => chips.get(n++) ?? value)
}
async function copyChatText(text, message = tr("已复制")) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else throw new Error('clipboard unavailable')
  } catch {
    const previous = document.activeElement
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0'
    document.body.appendChild(textarea)
    textarea.select()
    let copied = false
    try { copied = document.execCommand('copy') } catch { /* 浏览器禁用了复制 */ }
    textarea.remove()
    previous?.focus({ preventScroll: true })
    if (!copied) { showToast(tr("复制失败，请选中文字手动复制"), 'error'); return }
  }
  showToast(message, 'success')
}
function copyPrompt(roundIdx) {
  void copyChatText(promptForRound(roundIdx), tr("提示词已复制"))
}
function copyReply(roundIdx) {
  const c = conversations.find((x) => x.id === activeId)
  void copyChatText(conversationRounds(c)[roundIdx]?.text || '', tr("回复已复制"))
}
function reusePrompt(roundIdx) {
  const text = promptForRound(roundIdx)
  if (!text) return
  const existing = promptInput.value.trim()
  promptInput.value = existing && existing !== text ? `${existing}\n\n${text}` : text
  promptInput.dispatchEvent(new Event('input', { bubbles: true }))
  promptInput.focus({ preventScroll: true })
  showToast(tr("提示词已放入输入框，可修改后发送"), 'success')
}
async function useResultAsReference(roundIdx, imageIdx, button) {
  if (!parameterApplicable('attach')) { showToast(tr("当前模型不支持参考图（OpenRouter 未标注它支持图像输入）"), 'info'); return }
  if (inputImages.length >= MAX_INPUT_IMAGES) { showToast(tr("最多添加 {0} 张参考图", MAX_INPUT_IMAGES), 'info'); return }
  const c = conversations.find((x) => x.id === activeId)
  const srcId = conversationRounds(c)[roundIdx]?.images?.[imageIdx]
  if (!srcId) return
  button.disabled = true
  try {
    const src = await resolveImageSrc(srcId)
    if (!src) throw new Error('missing image')
    const response = await fetch(src)
    if (!response.ok) throw new Error('image unavailable')
    const blob = await response.blob()
    if (activeId !== c.id) return
    if (inputImages.length >= MAX_INPUT_IMAGES) { showToast(tr("参考图数量已达上限"), 'info'); return }
    if (await addInputImageFromFile(new File([blob], `reference-${imageIdx + 1}`, { type: blob.type }), c.id)) {
      promptInput.focus({ preventScroll: true })
      showToast(tr("已加入参考图，在输入框描述你想修改的地方"), 'success')
    }
  } catch { showToast(tr("无法读取这张图片，请稍后重试"), 'error') }
  finally { button.disabled = false }
}

function handleMarkdownClick(event) {
  const button = event.target.closest('[data-copy-code]')
  if (button) void copyChatText(button.closest('.chat-code').querySelector('pre code').textContent, tr("代码已复制"))
}
document.getElementById('chatView').addEventListener('click', handleMarkdownClick)
/* ===== 图片灯箱：Ctrl/普通滚轮缩放、拖拽平移、双击重置 ===== */
const LB = { img: null, stage: null, scale: 1, tx: 0, ty: 0, min: 0.2, max: 8, baseW: 0, natW: 0 }
let lightboxTimer = null
let lbDrag = null   // 拖拽期间的 window 监听，关闭时解绑

function lbApply(anim = true) {
  const img = LB.img
  if (!img) return
  img.classList.toggle('no-anim', !anim)
  img.style.transform = `translate3d(${LB.tx}px, ${LB.ty}px, 0) scale(${LB.scale})`
  img.classList.toggle('is-zoomed', LB.scale > 1.001)
  const zEl = document.getElementById('lbZoom')
  if (zEl) zEl.textContent = Math.round(LB.scale * 100) + '%'
  const bOut = document.querySelector('[data-lb="out"]')
  const bIn = document.querySelector('[data-lb="in"]')
  if (bOut) bOut.disabled = LB.scale <= LB.min + 0.001
  if (bIn) bIn.disabled = LB.scale >= LB.max - 0.001
}
/** 以 (ax, ay) 为锚点缩放到 nextScale，锚点下的像素保持不动 */
function lbZoomTo(nextScale, ax, ay) {
  const stage = LB.stage
  if (!stage) return
  const r = stage.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const px = (ax == null ? cx : ax) - cx
  const py = (ay == null ? cy : ay) - cy
  const s2 = Math.min(LB.max, Math.max(LB.min, nextScale))
  const k = s2 / LB.scale
  LB.tx = px - (px - LB.tx) * k
  LB.ty = py - (py - LB.ty) * k
  LB.scale = s2
  lbApply(true)
}
function lbReset() { LB.scale = 1; LB.tx = 0; LB.ty = 0; lbApply(true) }

function detachLbDrag() {
  if (!lbDrag) return
  window.removeEventListener('mousemove', lbDrag.move)
  window.removeEventListener('mouseup', lbDrag.up)
  lbDrag = null
}

function openLightbox(src) {
  closeLightbox(true)
  const lb = document.createElement('div')
  lb.id = 'lightbox'
  lb.className = 'lightbox'
  lb.innerHTML = `
    <div class="lb-stage" id="lbStage">
      <img class="lb-img" id="lbImg" src="${escapeHtml(src)}" alt="" draggable="false" />
    </div>
    <button class="lb-close" id="lbClose" title="${escapeHtml(tr("关闭 (Esc)"))}" data-i18n-title="关闭 (Esc)" aria-label="${escapeHtml(tr("关闭"))}" data-i18n-aria-label="关闭">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
    <div class="lb-bar">
      <button class="lb-btn" data-lb="out" title="${escapeHtml(tr("缩小 (−)"))}" data-i18n-title="缩小 (−)" aria-label="${escapeHtml(tr("缩小"))}" data-i18n-aria-label="缩小">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>
      </button>
      <span class="lb-zoom" id="lbZoom" title="${escapeHtml(tr("点击回到 100%"))}" data-i18n-title="点击回到 100%">100%</span>
      <button class="lb-btn" data-lb="in" title="${escapeHtml(tr("放大 (+)"))}" data-i18n-title="放大 (+)" aria-label="${escapeHtml(tr("放大"))}" data-i18n-aria-label="放大">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
      </button>
      <span class="lb-sep"></span>
      <button class="lb-btn" data-lb="fit" title="${escapeHtml(tr("适应屏幕 (0)"))}" data-i18n-title="适应屏幕 (0)" aria-label="${escapeHtml(tr("适应屏幕"))}" data-i18n-aria-label="适应屏幕">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>
      </button>
      <button class="lb-btn" data-lb="one" title="${escapeHtml(tr("原始尺寸 1:1"))}" data-i18n-title="原始尺寸 1:1" aria-label="${escapeHtml(tr("原始尺寸"))}" data-i18n-aria-label="原始尺寸">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h3v8H4zM17 8h3v8h-3zM9 12h6"/></svg>
      </button>
    </div>`
  document.body.appendChild(lb)

  const stage = lb.querySelector('#lbStage')
  const img = lb.querySelector('#lbImg')
  LB.stage = stage
  LB.img = img
  LB.scale = 1; LB.tx = 0; LB.ty = 0

  // 必须先 is-open（display:block），否则 img.offsetWidth 恒为 0，1:1 换算会失效
  lb.classList.add('is-open')
  const measure = () => {
    LB.baseW = img.offsetWidth || LB.baseW || 0
    LB.natW = img.naturalWidth || LB.natW || 0
    LB.natH = img.naturalHeight || LB.natH || 0
  }
  if (img.complete && img.naturalWidth) measure()
  else img.addEventListener('load', measure, { once: true })

  // 滚轮缩放：Ctrl+滚轮会被浏览器抢去做页面缩放，必须 preventDefault + passive:false
  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 100 : 1)
    const d = (e.deltaY || 0) * unit
    if (!d) return
    const factor = Math.exp(-d * (e.ctrlKey ? 0.0028 : 0.0022))
    lbZoomTo(LB.scale * factor, e.clientX, e.clientY)
  }, { passive: false })

  // 拖拽平移
  let down = false, moved = false, sx = 0, sy = 0, bx = 0, by = 0
  img.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    down = true; moved = false
    sx = e.clientX; sy = e.clientY; bx = LB.tx; by = LB.ty
    stage.classList.add('is-dragging')
  })
  const onMove = (e) => {
    if (!down) return
    const dx = e.clientX - sx, dy = e.clientY - sy
    if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true
    if (!moved) return
    LB.tx = bx + dx; LB.ty = by + dy
    lbApply(false)
  }
  const onUp = () => {
    if (!down) return
    down = false
    stage.classList.remove('is-dragging')
    setTimeout(() => { moved = false }, 0)
  }
  lbDrag = { move: onMove, up: onUp }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)

  // 双击：1x ↔ 2x
  img.addEventListener('dblclick', (e) => {
    e.stopPropagation()
    if (LB.scale > 1.001) lbReset()
    else lbZoomTo(2, e.clientX, e.clientY)
  })

  // 点空白处关闭（点图片、拖过都不关）
  lb.addEventListener('click', (e) => {
    if (e.target === stage && !moved) closeLightbox()
  })
  lb.querySelector('#lbClose').addEventListener('click', (e) => { e.stopPropagation(); closeLightbox() })

  // 工具条
  lb.querySelector('.lb-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-lb]')
    if (btn && !btn.disabled) {
      const act = btn.dataset.lb
      if (act === 'in') lbZoomTo(LB.scale * 1.25)
      else if (act === 'out') lbZoomTo(LB.scale / 1.25)
      else if (act === 'fit') lbReset()
      else if (act === 'one') {
        const z = LB.baseW ? LB.natW / LB.baseW : 1
        LB.scale = Math.min(LB.max, Math.max(LB.min, z)); LB.tx = 0; LB.ty = 0; lbApply(true)
      }
      return
    }
    if (e.target.closest('#lbZoom')) lbReset()
  })

  lb.classList.add('is-open')
  requestAnimationFrame(() => { lb.classList.add('show'); lbApply(false) })
}

function closeLightbox(immediate) {
  const lb = document.getElementById('lightbox')
  if (!lb) return
  clearTimeout(lightboxTimer)
  const done = () => {
    lb.remove()   // 关键：彻底移除 DOM，恢复鼠标指针，不留 fixed 全屏层
    detachLbDrag()
    LB.img = null; LB.stage = null; LB.scale = 1; LB.tx = 0; LB.ty = 0
  }
  lb.classList.remove('show')
  if (immediate) done()
  else lightboxTimer = setTimeout(done, 220)
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.getElementById('lightbox')) { closeLightbox(); return }
    if (multiMode) { exitMultiMode(); return }   // 多选模式 Esc 退出
    return
  }
  const lb = document.getElementById('lightbox')
  if (!lb || !lb.classList.contains('is-open')) return
  if (e.key === '+' || e.key === '=') { e.preventDefault(); lbZoomTo(LB.scale * 1.25) }
  else if (e.key === '-' || e.key === '_') { e.preventDefault(); lbZoomTo(LB.scale / 1.25) }
  else if (e.key === '0') { e.preventDefault(); lbReset() }
})
function startTitleEdit() {
  const btn = document.getElementById('titleBtn')
  const h2 = document.getElementById('mainTitle')
  if (!btn || !h2 || h2.tagName === 'INPUT') return
  const cur = h2.textContent
  const input = document.createElement('input')
  input.className = 'title-input'
  input.value = cur
  h2.replaceWith(input)
  input.focus(); input.select()
  let done = false
  const finish = (save) => {
    if (done) return
    done = true
    const v = input.value.trim()
    if (save && v && activeId != null) {
      const c = conversations.find((x) => x.id === activeId)
      if (c) {
        c.title = v
        c.autoTitle = false
        persistConversations()
        showToast(tr("已重命名"), 'success')
      }
    }
    const back = document.createElement('h2')
    back.id = 'mainTitle'
    back.className = ''
    back.textContent = conversationTitle(conversations.find((x) => x.id === activeId))
    input.replaceWith(back)
    renderList()
    back.parentElement.ondblclick = null
    const newBtn = back.closest('.title-button')
    if (newBtn) newBtn.onclick = startTitleEdit
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true)
    if (e.key === 'Escape') finish(false)
  })
  input.addEventListener('blur', () => finish(true))
}

/* =====================================================
   分享
   ===================================================== */
/** 复制到剪贴板：file:// 下 clipboard API 不可用，回退 execCommand */
async function copyText(text, okMsg) {
  if (!text) { showToast(tr("没有可复制的内容"), 'info'); return false }
  let done = false
  // 1) 优先 Clipboard API
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      done = true
    }
  } catch (e) { done = false }
  // 2) 回退 execCommand（file:// 或权限被拒时）
  if (!done) {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      done = document.execCommand('copy')
      ta.remove()
    } catch (e) { done = false }
  }
  showToast(done ? okMsg : tr("复制失败，请手动选中复制"), done ? 'success' : 'error')
  return done
}
/* =====================================================
   参数 pill 交互（点击循环切换 + toast）
   ===================================================== */
/* 所有参数统一为「上拉框选择」，不再点击循环切换 */
const PILL_OPTIONS = {
  format: ['PNG', 'JPEG', 'WebP'],
  transparent: ['false', 'true'],
}
const PILL_LABELS = {
  model: '模型', reasoning: '推理', quality: '质量',
  format: '格式', transparent: '透明', size: '尺寸',
}
/* 模型：内部保存 id，界面展示模型名称 */
let MODELS = []            // [{ id, name, reasoning }]
let currentModel = ''      // 模型 id
let modelCapabilityContext = null
const PILL_STATE = {
  reasoning: 'auto',
  quality: 'auto',
  format: 'PNG',
  transparent: 'false',
}
function modelName(id) {
  const m = MODELS.find((x) => x.id === id)
  return m ? (m.name || m.id) : (id || tr("未选择"))
}
function pillValue(key) { return key === 'model' ? currentModel : key === 'size' ? currentSize : PILL_STATE[key] }
function imageParameter(key) {
  const model = MODELS.find((m) => m.id === currentModel)
  const name = { format: 'output_format', transparent: 'background' }[key] || key
  return model?.kind === 'image' ? model.imageParameters?.[name] || false : false
}
function parameterApplicable(key) {
  const model = MODELS.find((m) => m.id === currentModel)
  if (key === 'model') return true
  if (key === 'reasoning') return model?.kind === 'chat' && pillOptions(key).length > 1
  if (key === 'quality') return model?.kind === 'image' && pillOptions(key).length > 1
  // 参考图对文本模型也开放：它会作为多模态内容一起发给模型，让模型看着图回答。
  // 判据是 OpenRouter 的 vision（input_modalities 含 image）；目录里没数据时是 null，
  // 这时不能顺手判成「不支持」——那会把能看图的模型的上传按钮给禁掉。
  // 只有 OpenRouter 明确说不支持（false），或 dall-e-3 这种不接受参考图的，才禁用。
  if (key === 'attach') return !!model && model.vision !== false && model.id.replace(/^openai\//, '') !== 'dall-e-3'
  const spec = imageParameter(key)
  if (!spec) return false
  if (key === 'transparent') return PILL_STATE.format !== 'JPEG' && (!spec.options || spec.options.includes('transparent'))
  if (key === 'size') return !spec.options || spec.options.length > 1
  return pillOptions(key).length > 1
}
function pillOptions(key) {
  if (key === 'model') return MODELS.map((m) => ({ value: m.id, label: m.name || m.id }))
  if (key === 'reasoning' || key === 'quality') {
    const model = MODELS.find((m) => m.id === currentModel)
    const values = key === 'reasoning' ? (model?.kind === 'chat' ? model.reasoningEfforts : []) : (model?.kind === 'image' ? model.qualityOptions : [])
    return [...new Set(['auto', ...(values || [])])]
      .filter((value) => key !== 'reasoning' || value !== 'none')
      .map((value) => ({ value, label: value === 'auto' ? tr("自动") : value }))
  }
  const spec = imageParameter(key)
  if (!spec) return []
  if (key === 'size') return (spec.options || []).map((value) => ({ value, label: value === 'auto' ? tr("自动") : value.replace('x', '×') }))
  return (PILL_OPTIONS[key] || [])
    .filter((value) => key === 'transparent' || !spec.options || spec.options.includes(value.toLowerCase()))
    .map((value) => ({ value, label: value === 'auto' ? tr("自动") : value }))
}
function syncModelCapabilities() {
  const model = MODELS.find((m) => m.id === currentModel)
  const profileId = activeProfile()?.id
  const modelChanged = modelCapabilityContext?.modelId !== currentModel || modelCapabilityContext?.profileId !== profileId
  for (const key of ['reasoning', 'quality', 'format', 'transparent']) {
    const options = pillOptions(key)
    const applicable = parameterApplicable(key)
    if ((key === 'reasoning' || applicable || (model?.kind === 'image' && options.length === 1))
        && ((key === 'reasoning' && modelChanged) || !options.some((o) => o.value === PILL_STATE[key]))) {
      // 切换模型或 API 配置后使用该模型的默认推理强度，不沿用上一模型的选择。
      const defaultValue = key === 'reasoning' ? model?.defaultReasoningEffort : key === 'quality' ? model?.defaultQuality : 'auto'
      PILL_STATE[key] = options.some((o) => o.value === defaultValue) ? defaultValue : options[0]?.value || 'auto'
    }
    refreshPill(key)
    renderPillMenu(key)
    const button = document.getElementById('val-' + key)?.closest('button')
    if (button) {
      button.disabled = !applicable
      button.classList.toggle('is-disabled', !applicable)
      button.title = key === 'reasoning' && model?.kind === 'image'
        ? tr("当前图片接口不提供单独的推理强度，可调整图片质量")
        : key === 'transparent' && model?.kind === 'image' && PILL_STATE.format === 'JPEG'
          ? tr("JPEG 不支持透明背景，请选择 PNG 或 WebP")
          : !applicable ? tr("{0}：不适用", tr(PILL_LABELS[key])) : tr("选择{0}", tr(PILL_LABELS[key]))
      if (button.disabled) document.getElementById('menu-' + key)?.classList.remove('open')
    }
  }
  const sizeOptions = pillOptions('size')
  if (parameterApplicable('size') && sizeOptions.length && !sizeOptions.some((o) => o.value === currentSize)) currentSize = sizeOptions[0].value
  refreshSizePill()
  renderPillMenu('size')
  if (SZ.open && (modelChanged || !parameterApplicable('size'))) closeSizePicker()
  const attach = document.getElementById('attachBtn')
  if (attach) {
    attach.disabled = !parameterApplicable('attach')
    attach.title = attach.disabled ? tr("参考图：不适用") : tr("上传参考图让模型看着图回答（可多选）")
    document.getElementById('val-attach').hidden = !attach.disabled
  }
  modelCapabilityContext = { modelId: currentModel, profileId }
}
function refreshPill(key) {
  const el = document.getElementById('val-' + key)
  if (!el) return
  el.textContent = key === 'model' ? modelName(currentModel) : (PILL_STATE[key] === 'auto' ? tr("自动") : PILL_STATE[key])
  if (!parameterApplicable(key)) el.textContent = tr("不适用")
  if (key === 'model') el.title = currentModel
}
function renderPillMenu(key) {
  const menu = document.getElementById('menu-' + key)
  if (!menu) return
  const cur = pillValue(key)
  menu.innerHTML = pillOptions(key).map((o) => `
    <button type="button" class="pill-menu-item ${o.value === cur ? 'is-active' : ''}" data-v="${escapeHtml(o.value)}" title="${escapeHtml(o.label)}">
      <span class="pill-menu-label">${escapeHtml(o.label)}</span>
      <svg class="check" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
    </button>`).join('')
  menu.querySelectorAll('.pill-menu-item').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); selectPill(key, b.dataset.v) }
  })
}
function closeAllPillMenus() {
  document.querySelectorAll('.pill-menu.open').forEach((m) => m.classList.remove('open'))
}
function togglePillMenu(e, key) {
  e?.stopPropagation()
  if (!parameterApplicable(key)) return
  const menu = document.getElementById('menu-' + key)
  if (!menu) return
  const wasOpen = menu.classList.contains('open')
  closeAllPillMenus()
  if (!wasOpen) { renderPillMenu(key); menu.classList.add('open') }
}
function selectPill(key, value) {
  if (!parameterApplicable(key) || !pillOptions(key).some((o) => o.value === value)) return
  if (key === 'model') {
    currentModel = value
    S.modelPinned = true // 手动选过之后，不再被默认值覆盖
    syncModelCapabilities()
    persistSettings()
  }
  else if (key === 'size') { currentSize = value; refreshSizePill(); persistSettings() }
  else { PILL_STATE[key] = value; syncModelCapabilities(); persistSettings() }
  closeAllPillMenus()
  if (key !== 'size') refreshPill(key)
  showToast(tr('{0}：{1}', tr(PILL_LABELS[key] || key), key === 'model' ? modelName(value) : value), 'success')
}
document.addEventListener('click', closeAllPillMenus)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPillMenus() })

/* 与「设置 → 模型列表」联动：增删改模型后候选与展示名同步更新 */
function syncComposerModels() {
  const p = activeProfile()
  if (!p) return
  MODELS = (p.models || []).filter(isVisibleModel).map((m) => ({ ...m }))
  // 用户没手动选过模型时始终用默认值，否则会一直停在残留的聊天模型上导致生图报错
  const known = MODELS.some((m) => m.id === currentModel)
  if (!known || !S.modelPinned) currentModel = pickDefaultModel(MODELS)
  refreshPill('model')
  syncModelCapabilities()
}

/* 默认模型：优先生图模型（本应用主用途），其次 gpt-image-2.5-sunburst。
   不能简单取 MODELS[0] —— 上游返回的第一个往往是聊天模型，
   拿它去请求生图接口会被上游拒绝。 */
function pickDefaultModel(models) {
  if (!models || !models.length) return ''
  const images = models.filter((m) => m.kind === 'image')
  const pool = images.length ? images : models
  const preferred = pool.find((m) => m.id === 'gpt-image-2.5-sunburst')
  return (preferred || pool[0]).id
}
/* =====================================================
   尺寸选择：照搬 gpt_image_playground/src/lib/size.ts
   ===================================================== */
const SIZE_MULTIPLE = 16
const SIZE_MAX_EDGE = 3840
const SIZE_MAX_ASPECT_RATIO = 3
const SIZE_MIN_PIXELS = 655360
const SIZE_MAX_PIXELS = 8294400
const SIZE_MAX_1K_PIXELS = 1572864
const SIZE_TIERS = ['1K', '2K', '4K']
const SIZE_RATIOS = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '21:9']
const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/
const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/
const SIZE_LIMIT_TEXT = '由于模型限制，不符合要求的分辨率会被自动规整：\n宽高均为 16 的倍数，最大边长 3840px，宽高比不超过 3:1，总像素限制为 655360-8294400。'
const SIZE_CLAMPED_TEXT = '由于模型限制，原始分辨率已被自动规整'
const TIER_PIXEL_BUDGET = { '1K': SIZE_MAX_1K_PIXELS, '2K': 4194304, '4K': SIZE_MAX_PIXELS }
const COMMON_SIZE_PRESETS = {
  '1K': { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536', '16:9': '1280x720', '9:16': '720x1280', '4:3': '1024x768', '3:4': '768x1024', '21:9': '1280x544' },
  '2K': { '1:1': '2048x2048', '3:2': '2160x1440', '2:3': '1440x2160', '16:9': '2560x1440', '9:16': '1440x2560', '4:3': '2048x1536', '3:4': '1536x2048', '21:9': '2560x1088' },
  '4K': { '1:1': '2880x2880', '3:2': '3456x2304', '2:3': '2304x3456', '16:9': '3840x2160', '9:16': '2160x3840', '4:3': '3200x2400', '3:4': '2400x3200', '21:9': '3840x1600' },
}
function gcdNum(a, b) { return b === 0 ? a : gcdNum(b, a % b) }
function roundToMultiple(v, m) { return Math.max(m, Math.round(v / m) * m) }
function floorToMultiple(v, m) { return Math.max(m, Math.floor(v / m) * m) }
function ceilToMultiple(v, m) { return Math.max(m, Math.ceil(v / m) * m) }
function normalizeDimensions(width, height) {
  let nw = roundToMultiple(width, SIZE_MULTIPLE)
  let nh = roundToMultiple(height, SIZE_MULTIPLE)
  for (let i = 0; i < 4; i++) {
    const maxEdge = Math.max(nw, nh)
    if (maxEdge > SIZE_MAX_EDGE) {
      const s = SIZE_MAX_EDGE / maxEdge
      nw = floorToMultiple(nw * s, SIZE_MULTIPLE)
      nh = floorToMultiple(nh * s, SIZE_MULTIPLE)
    }
    if (nw / nh > SIZE_MAX_ASPECT_RATIO) nw = floorToMultiple(nh * SIZE_MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    else if (nh / nw > SIZE_MAX_ASPECT_RATIO) nh = floorToMultiple(nw * SIZE_MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    const pixels = nw * nh
    if (pixels > SIZE_MAX_PIXELS) {
      const s = Math.sqrt(SIZE_MAX_PIXELS / pixels)
      nw = floorToMultiple(nw * s, SIZE_MULTIPLE)
      nh = floorToMultiple(nh * s, SIZE_MULTIPLE)
    } else if (pixels < SIZE_MIN_PIXELS) {
      const s = Math.sqrt(SIZE_MIN_PIXELS / pixels)
      nw = ceilToMultiple(nw * s, SIZE_MULTIPLE)
      nh = ceilToMultiple(nh * s, SIZE_MULTIPLE)
    }
  }
  return { width: nw, height: nh }
}
function normalizeImageSize(size) {
  const m = String(size).trim().match(SIZE_PATTERN)
  if (!m) return String(size).trim()
  const d = normalizeDimensions(Number(m[1]), Number(m[2]))
  return `${d.width}x${d.height}`
}
function parseRatio(ratio) {
  const m = String(ratio).match(RATIO_PATTERN)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}
function getPresetRatioKey(rw, rh) {
  if (!Number.isInteger(rw) || !Number.isInteger(rh)) return null
  const d = gcdNum(rw, rh)
  const key = `${rw / d}:${rh / d}`
  return key in COMMON_SIZE_PRESETS['1K'] ? key : null
}
function calculateImageSize(tier, ratio) {
  const parsed = parseRatio(ratio)
  if (!parsed) return null
  const key = getPresetRatioKey(parsed.width, parsed.height)
  if (key) return COMMON_SIZE_PRESETS[tier][key]
  const targetRatio = parsed.width / parsed.height
  const budget = TIER_PIXEL_BUDGET[tier]
  let bw = 0, bh = 0, bp = 0
  for (let w = SIZE_MULTIPLE; w <= SIZE_MAX_EDGE; w += SIZE_MULTIPLE) {
    const idealH = w / targetRatio
    const candidates = [Math.floor(idealH / SIZE_MULTIPLE) * SIZE_MULTIPLE, Math.ceil(idealH / SIZE_MULTIPLE) * SIZE_MULTIPLE]
    for (const h of candidates) {
      if (h < SIZE_MULTIPLE || h > SIZE_MAX_EDGE) continue
      const pixels = w * h
      if (pixels > budget || pixels < SIZE_MIN_PIXELS) continue
      if (Math.max(w / h, h / w) > SIZE_MAX_ASPECT_RATIO) continue
      if (Math.abs(w / h - targetRatio) / targetRatio > 0.01) continue
      if (pixels > bp) { bp = pixels; bw = w; bh = h }
    }
  }
  return bp === 0 ? null : `${bw}x${bh}`
}
function findPresetForSize(size) {
  const normalized = normalizeImageSize(size)
  for (const tier of SIZE_TIERS) {
    for (const r of SIZE_RATIOS) {
      if (calculateImageSize(tier, r) === normalized) return { tier, ratio: r }
    }
  }
  return null
}

/* =====================================================
   尺寸选择弹窗（照搬 SizePickerModal.tsx）
   ===================================================== */
let currentSize = 'auto'
const SZ = { open: false, mode: 'auto', tier: '1K', ratio: '1:1', customRatio: '16:9', customW: '1024', customH: '1024' }
const SIZE_MODES = [['auto', '自动'], ['ratio', '按比例'], ['resolution', '自定义宽高']]

function refreshSizePill() {
  const el = document.getElementById('val-size')
  if (!el) return
  const applicable = parameterApplicable('size')
  el.textContent = !applicable ? tr("不适用") : currentSize === 'auto' ? 'auto' : String(currentSize).replace('x', '×')
  const button = el.closest('button')
  button.disabled = !applicable
  button.classList.toggle('is-disabled', !applicable)
  button.title = applicable ? tr("点击设置图像尺寸") : tr("尺寸：不适用")
  if (!applicable) document.getElementById('menu-size')?.classList.remove('open')
}
function openSizePicker(event) {
  if (!parameterApplicable('size')) return
  if (pillOptions('size').length) { togglePillMenu(event, 'size'); return }
  const preset = currentSize && currentSize !== 'auto' ? findPresetForSize(currentSize) : null
  const parsed = String(currentSize).match(SIZE_PATTERN)
  SZ.mode = (!currentSize || currentSize === 'auto') ? 'auto' : (preset ? 'ratio' : 'resolution')
  if (preset) { SZ.tier = preset.tier; SZ.ratio = preset.ratio }
  if (parsed) { SZ.customW = parsed[1]; SZ.customH = parsed[2] }
  SZ.open = true
  renderSizePicker()
  document.addEventListener('keydown', onSizeKey)
}
function onSizeKey(e) { if (e.key === 'Escape') closeSizePicker() }
function closeSizePicker() {
  SZ.open = false
  document.removeEventListener('keydown', onSizeKey)
  const layer = document.getElementById('sizeLayer')
  const root = document.getElementById('sizeRoot')
  if (!root) return
  if (layer) {
    layer.classList.remove('show')
    setTimeout(() => { if (!SZ.open) root.innerHTML = '' }, 220)
  } else root.innerHTML = ''
}
function sizeModesHtml() {
  return SIZE_MODES.map(([id, label]) => `<button class="size-mode ${SZ.mode === id ? 'is-active' : ''}" data-size-key="mode:${id}" onclick="setSizeMode('${id}')">${escapeHtml(tr(label))}</button>`).join('')
}
function updateSizePicker(focus) {
  const layer = document.getElementById('sizeLayer')
  if (!layer) return false
  const body = layer.querySelector('.size-body')
  if (body) {
    const scrollTop = body.scrollTop
    body.innerHTML = sizeBodyHtml()
    body.scrollTop = scrollTop
  }
  const modes = layer.querySelector('.size-modes')
  if (modes) modes.innerHTML = sizeModesHtml()
  updateSizePreview()
  if (focus) {
    requestAnimationFrame(() => {
      if (!SZ.open || !layer.isConnected) return
      const key = `${focus.kind}:${focus.value}`
      const control = Array.from(layer.querySelectorAll('[data-size-key]')).find((item) => item.dataset.sizeKey === key)
      if (control) control.focus({ preventScroll: true })
    })
  }
  return true
}
function setSizeMode(m) { SZ.mode = m; renderSizePicker({ kind: 'mode', value: m }) }
function setSizeTier(t) { SZ.tier = t; renderSizePicker({ kind: 'tier', value: t }) }
function setSizeRatio(r) { SZ.ratio = r; renderSizePicker({ kind: 'ratio', value: r }) }
function activeSizeRatio() { return SZ.ratio === 'custom' ? SZ.customRatio : SZ.ratio }
function previewSizeValue() {
  if (SZ.mode === 'auto') return 'auto'
  if (SZ.mode === 'ratio') {
    const s = calculateImageSize(SZ.tier, activeSizeRatio())
    return s ? normalizeImageSize(s) : ''
  }
  const w = parseInt(SZ.customW, 10)
  const h = parseInt(SZ.customH, 10)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return normalizeImageSize(`${w}x${h}`)
  return ''
}
function isSizeClamped() {
  const pv = previewSizeValue()
  if (!pv || pv === 'auto') return false
  if (SZ.mode === 'resolution') {
    const w = parseInt(SZ.customW, 10)
    const h = parseInt(SZ.customH, 10)
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `${w}x${h}` !== pv
  }
  return false
}
function onSizeInput(field, value) { SZ[field] = value; updateSizePreview() }
function updateSizePreview() {
  const pv = previewSizeValue()
  const el = document.getElementById('sizePreviewValue')
  if (el) el.textContent = pv || tr("尺寸无效")
  const ok = document.getElementById('sizeOk')
  if (ok) ok.disabled = !pv
  const warn = document.getElementById('sizeWarn')
  if (warn) warn.style.display = isSizeClamped() ? 'inline-flex' : 'none'
}
function applySize() {
  if (!parameterApplicable('size')) { closeSizePicker(); return }
  const pv = previewSizeValue()
  if (!pv) return
  const options = pillOptions('size')
  if (options.length && !options.some((option) => option.value === pv)) return
  currentSize = pv
  refreshSizePill()
  closeSizePicker()
  persistSettings()
  showToast(tr("尺寸：{0}", pv === 'auto' ? tr("自动") : pv.replace('x', '×')), 'success')
}
function sizeBodyHtml() {
  if (SZ.mode === 'auto') {
    return `<div class="size-auto-wrap">
      <div class="size-auto-ic">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
      </div>
      <div class="size-auto-title">${escapeHtml(tr("自动尺寸"))}</div>
      <div class="size-auto-desc">${escapeHtml(tr("不向模型传递具体的分辨率参数"))}<br/>${escapeHtml(tr("由模型自己决定生成尺寸"))}</div>
    </div>`
  }
  if (SZ.mode === 'ratio') {
    const tiers = SIZE_TIERS.map((t) => `<button class="size-opt ${SZ.tier === t ? 'is-active' : ''}" data-size-key="tier:${t}" onclick="setSizeTier('${t}')">${t}</button>`).join('')
    const ratios = SIZE_RATIOS.map((r) => {
      const [w, h] = r.split(':').map(Number)
      const isHorizontal = w > h
      const isSquare = w === h
      const boxW = isHorizontal || isSquare ? '100%' : `${(w / h) * 100}%`
      const boxH = !isHorizontal || isSquare ? '100%' : `${(h / w) * 100}%`
      return `<button class="size-opt size-ratio-opt ${SZ.ratio === r ? 'is-active' : ''}" data-size-key="ratio:${r}" onclick="setSizeRatio('${r}')" title="${r}">
        <span class="size-ratio-box"><i style="width:${boxW};height:${boxH}"></i></span>
        <span style="font-size:12px">${r}</span>
      </button>`
    }).join('')
    const parsedCustom = parseRatio(SZ.customRatio)
    return `
      <section style="margin-bottom:20px">
        <div class="size-section-title">${escapeHtml(tr("基准分辨率"))}</div>
        <div class="size-tiers">${tiers}</div>
      </section>
      <section>
        <div class="size-section-title">${escapeHtml(tr("图像比例"))}</div>
        <div class="size-ratios">
          ${ratios}
          <button class="size-opt size-ratio-span ${SZ.ratio === 'custom' ? 'is-active' : ''}" data-size-key="ratio:custom" onclick="setSizeRatio('custom')">${escapeHtml(tr("自定义比例"))}</button>
        </div>
      </section>
      ${SZ.ratio === 'custom' ? `
      <label style="display:block;margin-top:14px">
        <span class="size-field-label">${escapeHtml(tr("输入自定义比例"))}</span>
        <input class="field-input" style="${parsedCustom ? '' : 'border-color:#fca5a5'}" value="${escapeHtml(SZ.customRatio)}" placeholder="${escapeHtml(tr("例如 5:4 / 2.39:1"))}" oninput="onSizeInput('customRatio', this.value)" />
      </label>` : ''}`
  }
  return `
    <section>
      <div class="size-section-title" style="margin-bottom:14px">${escapeHtml(tr("输入具体像素值"))}</div>
      <div class="size-num-row">
        <label>
          <span class="size-field-label">${escapeHtml(tr("宽度 (Width)"))}</span>
          <input class="field-input" type="number" value="${escapeHtml(SZ.customW)}" placeholder="${escapeHtml(tr("例如 1024"))}" oninput="onSizeInput('customW', this.value)" />
        </label>
        <span class="size-x">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </span>
        <label>
          <span class="size-field-label">${escapeHtml(tr("高度 (Height)"))}</span>
          <input class="field-input" type="number" value="${escapeHtml(SZ.customH)}" placeholder="${escapeHtml(tr("例如 1024"))}" oninput="onSizeInput('customH', this.value)" />
        </label>
      </div>
    </section>
    <div class="size-note" style="margin-top:16px">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <div>${escapeHtml(tr(SIZE_LIMIT_TEXT))}</div>
    </div>`
}
function renderSizePicker(focus) {
  const root = document.getElementById('sizeRoot')
  if (!root || !SZ.open) return
  const existing = document.getElementById('sizeLayer')
  if (existing) {
    updateSizePicker(focus)
    if (!existing.classList.contains('show')) {
      requestAnimationFrame(() => {
        if (SZ.open && existing.isConnected) existing.classList.add('show')
      })
    }
    return
  }
  const pv = previewSizeValue()
  root.innerHTML = `
    <div class="modal-layer size-layer" id="sizeLayer" onclick="if(event.target.id==='sizeLayer') closeSizePicker()">
      <div class="modal size-modal">
        <div class="modal-header">
          <div>
            <div class="modal-title" data-i18n="设置图像尺寸">${escapeHtml(tr("设置图像尺寸"))}</div>
            <div class="modal-sub">${escapeHtml(tr("当前：{0}", currentSize || 'auto'))}</div>
          </div>
          <button class="modal-close" onclick="closeSizePicker()" title="${escapeHtml(tr("关闭"))}" data-i18n-title="关闭">${ICON_X}</button>
        </div>
        <div class="size-modes">
          ${sizeModesHtml()}
        </div>
        <div class="modal-body size-body">${sizeBodyHtml()}</div>
        <div class="size-preview">
          <div class="size-preview-label" data-i18n="将使用">${escapeHtml(tr("将使用"))}</div>
          <div class="size-preview-value">
            <span id="sizePreviewValue">${escapeHtml(pv || tr("尺寸无效"))}</span>
            <span class="size-warn" id="sizeWarn" style="display:${isSizeClamped() ? 'inline-flex' : 'none'}" title="${escapeHtml(tr(SIZE_CLAMPED_TEXT))}" data-i18n-title="${escapeHtml(SIZE_CLAMPED_TEXT)}">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </span>
          </div>
        </div>
        <div class="size-actions">
          <button class="size-btn cancel" data-i18n="取消" onclick="closeSizePicker()">${escapeHtml(tr("取消"))}</button>
          <button class="size-btn ok" id="sizeOk" data-i18n="确定" onclick="applySize()" ${pv ? '' : 'disabled'}>${escapeHtml(tr("确定"))}</button>
        </div>
      </div>
    </div>`
  requestAnimationFrame(() => {
    const l = document.getElementById('sizeLayer')
    if (l) l.classList.add('show')
  })
}

/* =====================================================
   发送按钮：收集参数 → 调后端生成
   ===================================================== */
/* 收集当前界面上的生图参数 */
function buildParams(prompt) {
  const params = { model: currentModel, prompt }
  const model = MODELS.find((m) => m.id === currentModel)
  if (model?.kind === 'chat') {
    if (PILL_STATE.reasoning !== 'auto' && PILL_STATE.reasoning !== 'none' && model.reasoningEfforts?.includes(PILL_STATE.reasoning)) params.reasoning_effort = PILL_STATE.reasoning
    return params
  }
  if (parameterApplicable('size')) params.size = currentSize || 'auto'
  if (parameterApplicable('quality')) params.quality = PILL_STATE.quality || 'auto'
  if (parameterApplicable('format')) params.output_format = PILL_STATE.format.toLowerCase()
  if (parameterApplicable('transparent') && PILL_STATE.transparent === 'true') params.background = 'transparent'
  return params
}

/** 为图片工具提供本轮之前的上下文，以及上传图或最近一次生成的图片。 */
async function imageContext(c, round, signal) {
  const rounds = conversationRounds(c)
  const index = rounds.indexOf(round)
  const before = (index < 0 ? rounds : rounds.slice(0, index)).filter((r) => !r.error && !r.cancelled)
  const history = []
  for (const r of before.slice(-10)) {
    if (!r.text && !r.images?.length) continue
    if (r.prompt) history.push({ role: 'user', content: r.prompt })
    history.push({ role: 'assistant', content: r.text || `已生成图片。图片描述：${r.imagePrompt || r.prompt || ''}` })
  }
  const uploaded = round?.referenceImages || []
  const refs = uploaded.length ? uploaded : (before.findLast((r) => r.images?.length)?.images || [])
  const images = await refsToDataUrls(refs, signal)
  signal.throwIfAborted()
  return { history, images, reference_source: uploaded.length ? 'uploaded' : 'previous' }
}

async function handleSend() {
  const promptEl = document.getElementById('promptInput')
  const prompt = promptEl.value.trim()
  if (isRunning) {
    // 生成中再点发送，两种意图要分开：
    //   输入框里有内容 → 排队，这轮结束自动接着发（不用干等，也不用忍痛取消）
    //   输入框空着点   → 才是取消当前任务
    if (prompt) {
      pendingInputs.push({ prompt, params: buildParams(prompt), referenceImages: parameterApplicable('attach') ? [...inputImages] : [], conversationId: activeId })
      if (G.clearInputAfterSubmit) clearComposer()
      showToast(tr("已排队（第 {0} 条），当前生成结束后自动发送", pendingInputs.length), 'info')
      return
    }
    cancelGeneration()
    return
  }
  if (!prompt) {
    showToast(tr("请先输入描述"), 'error')
    promptInput.focus({ preventScroll: true })
    return
  }

  const profile = activeProfile()
  if (!profile || !profile.key || !profile.key.trim()) {
    showToast(tr("请先在设置里填写 API Key"), 'error')
    openSettings()
    return
  }
  if (!currentModel) { showToast(tr("请先选择模型"), 'error'); return }
  requestTaskNotificationPermission()
  // 在清空编辑器之前快照参考图和参数；本轮及排队任务不受随后输入影响。
  const params = buildParams(prompt)
  const references = parameterApplicable('attach') ? [...inputImages] : []

  // 没有当前对话时先建一个，否则发出去的内容没有落点，界面上什么都不会出现
  if (!conversations.find((x) => x.id === activeId)) handleNewConversation()

  // 记入当前对话的轮次（供「历史提问」定位）
  const c = conversations.find((x) => x.id === activeId)
  if (c) {
    if (!Array.isArray(c.messages)) c.messages = []
    c.messages.push({
      prompt,
      images: [],
      sentAt: nowStamp(),
      duration: '',
      referenceImages: references,
    })
    // 新对话用第一条提问当标题，别一直挂着「新对话」（和常见聊天软件一致）
    if (c.title === '新对话' || !c.title) {
      c.title = prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt
      c.autoTitle = false
      syncTitle()
    }
    // 本轮数据已快照，按偏好清空编辑器。
    if (G.clearInputAfterSubmit) clearComposer()
    const round = c.messages[c.messages.length - 1]
    setRunningRound(c, round, taskKindFor(currentModel)) // 这一轮进入「生成中」，气泡里转圈
    stickBottom()
    renderChatView()
    scrollChatToBottom()           // 发出去看自己这条，滚到最新
    if (typeof persistConversations === 'function') {
      await persistConversations() // 长任务开始前先落库，刷新也能看到已发送内容
    }
  }
  const round = c && c.messages[c.messages.length - 1]
  await doGenerate(prompt, params, c, round)
  await drainPendingInputs()   // 生成期间排队的话，接着发
}

/** 生成中排队的提问：上一轮结束后依次自动发出 */
let pendingInputs = []
async function drainPendingInputs() {
  while (pendingInputs.length && !isRunning) {
    const next = pendingInputs.shift()
    const c = conversations.find((x) => x.id === next.conversationId)
    if (!c) continue
    if (!Array.isArray(c.messages)) c.messages = []
    c.messages.push({ prompt: next.prompt, images: [], referenceImages: next.referenceImages, sentAt: nowStamp(), duration: '' })
    const round = c.messages[c.messages.length - 1]
    setRunningRound(c, round, taskKindFor(next.params.model))
    stickBottom()
    renderChatView()
    scrollChatToBottom()
    if (typeof persistConversations === 'function') await persistConversations()
    await doGenerate(next.prompt, next.params, c, round)
  }
}

/** 清空输入框：文本 + 自动撑开的高度一并复位 */
function clearComposer() {
  const el = document.getElementById('promptInput')
  if (!el) return
  el.value = ''
  inputImages = []
  renderInputImages()
  promptInput.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 当前时间，格式与侧栏一致：2026-09-14 14:38 */
function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 失败时自动让后端体检一次上游，把结论拼进错误提示。
 * 只在「请求确实到了后端」时才调 —— 浏览器连不上后端的话，调它也没意义。
 * 体检可能要几十秒，所以这里兜一个 50 秒的超时，失败就静默放弃，
 * 绝不能让体检本身的错误盖掉真正的错误。
 */
async function upstreamReport(profile, model, probe) {
  try {
    const ctrl = new AbortController()
    // 后端最坏要探：模型列表 30s + 两个聊天口各 45s / 生图 90s，给它 130 秒。
    // 这是在后台跑的，不阻塞界面，宽一点没关系。
    const budget = 130000
    const timer = setTimeout(() => ctrl.abort(), budget)
    const cred = { baseUrl: profile.url, apiKey: profile.key }
    const r = await ByChatAPI.diagUpstream(cred, model, probe, ctrl.signal)
    clearTimeout(timer)
    const bad = (r.results || []).filter((x) => x.http !== 200)
    if (!bad.length) return tr("\n（上游体检：各接口都正常，可能是偶发，建议重试一次）")
    const lines = bad.map((x) => `  · ${x.name}：HTTP ${x.http || '-'}（${x.ms}ms）${x.verdict}`)
    return tr("\n上游体检（{0}）：\n{1}", r.base_url, lines.join('\n'))
  } catch {
    return '' // 体检本身失败就算了，绝不盖掉真正的错误
  }
}

/**
 * 后台体检上游，结论拿到后回填到这一轮的错误气泡里。
 * 故意不 await：体检最长要一分多钟，不能让用户干等着才看到失败提示 ——
 * 先把错误显示出来，体检结论稍后自己长到气泡下面。
 */
function diagnoseInto(profile, model, probe, round, c) {
  upstreamReport(profile, model, probe).then((report) => {
    if (!report || !round) return
    round.error = (round.error || '') + report
    if (c && c.id === activeId) renderChatView()
    persistConversations()
  })
}

/* 真正的生成流程：文生图 / 改图。「重新生成」也走这里 */
async function doGenerate(prompt, params, c, round) {
  const profile = activeProfile()
  if (!profile || !profile.key || !profile.key.trim()) {
    showToast(tr("请先在设置里填写 API Key"), 'error')
    openSettings()
    return
  }
  if (!params.model) { showToast(tr("请先选择模型"), 'error'); return }

  const imageTask = taskKindFor(params.model) === 'image'
  params = { ...params }
  // 兼容旧任务：辅助模型已由后端决定，旧配置不能影响生图或独立聊天。
  delete params.text_model
  if (imageTask) delete params.reasoning_effort

  isRunning = true
  currentAbort = new AbortController()
  const signal = currentAbort.signal
  if (round) {
    delete round.cancelled
    delete round.usage
    delete round.error
    round.phase = imageTask ? 'planning' : 'chat'
    round.params = params
  }
  // 标记这一轮为「生成中」（发送入口已经设过，这里兜底，保证重试也有转圈）
  setRunningRound(c, round, imageTask ? 'image' : 'chat')
  renderChatView()
  const btn = document.getElementById('sendBtn')
  const icon = document.getElementById('sendIcon')
  btn.classList.add('is-running')
  icon.innerHTML = '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />'
  showToast(imageTask ? tr("已提交图片任务") : tr("已发送"), 'info')

  const skel = document.getElementById('skeletonWrap')
  skel.style.display = 'block'
  const startedAt = Date.now()
  let count = 0 // 成功出图张数（循环外声明，收尾的提示要用）

  // 放在 try 外面：catch 里体检上游时也要用（try 里声明的变量 catch 拿不到）
  let requestModel = params.model
  let requestKind = imageTask ? 'images' : 'chat'
  let awaitingUpstream = false

  try {
    const cred = { baseUrl: profile.url, apiKey: profile.key }

    if (!imageTask) {
      // 选了文本模型又带了参考图：不是错误，按多模态问答处理（模型看着图回答）
      const chatRefs = await refsToDataUrls(round?.referenceImages || [], signal)
      setRunningRound(c, round, 'chat')   // 转圈文案切成「等待回复」
      streamingText = ''
      streamingReasoning = ''
      stickBottom()                      // 文本是一段段长出来的，整段期间保持贴底
      renderChatView()
      let full = ''
      let reason = ''
      awaitingUpstream = true
      for await (const { event, data } of ByChatAPI.streamChat(cred, {
        mode: chatModeFor(params.model),   // claude→messages / gpt→responses / 其他→auto
        model: params.model,
        reasoning_effort: params.reasoning_effort,
        messages: chatHistory(c, round, prompt, chatRefs),   // 带上历史，否则模型没有记忆
      }, signal)) {
        if (event === 'content') {
          full += data.text
          streamingText = full
          updateStreamingBubble()         // 边收边显示，不再攒到最后
        } else if (event === 'reasoning') {
          reason += data.text
          streamingReasoning = reason
          updateStreamingBubble()
        } else if (event === 'usage') {
          if (round) round.usage = data    // 用量：后端算好了，接住显示
        } else if (event === 'error') {
          throw new Error(data.message || tr("上游返回错误"))
        }
      }
      awaitingUpstream = false
      if (!full.trim() && !reason.trim()) throw new Error(tr('聊天接口没有返回任何内容。'))
      if (round) {
        round.text = full
        round.reasoning = reason || ''
        round.images = []
        round.duration = `${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`
        round.params = params
        delete round.error
      }
      await persistConversations(true)
      streamingText = ''
      streamingReasoning = ''
    } else {
      const context = await imageContext(c, round, signal)
      requestKind = 'image-plan'
      awaitingUpstream = true
      const plan = await ByChatAPI.planImage(cred, { ...context, prompt }, signal)
      awaitingUpstream = false
      signal.throwIfAborted()
      const files = plan.reference_images.map((id) => dataUrlToFile(context.images[id - 1], `ref-${id}`))
      if (round) {
        round.phase = 'image'
        round.imagePrompt = plan.prompt
        round.usage = plan.usage
      }
      if (c?.id === activeId) renderChatView()
      requestModel = params.model
      requestKind = 'images'
      awaitingUpstream = true
      // 图片接口仅接收自身参数；文本模型的推理设置不会混入图片请求。
      const imageParams = { ...params, prompt: plan.prompt }
      const result = files.length
        ? await ByChatAPI.editImage(cred, imageParams, files, signal)
        : await ByChatAPI.generateImage(cred, imageParams, signal)
      awaitingUpstream = false

      const ids = []
      if (round) round.images = ids
      for (const img of result.images) {
        // 图片只存本机 IndexedDB；会话里记 id，不记会失效的 blob: 地址
        const id = await ByChatDB.saveImageBlob(img.blob)
        IMAGE_URLS.set(id, img.url) // 本次会话直接复用，不用再读一次库
        ids.push(id)
        count += 1
      }

      if (round) {
        round.images = ids
        round.duration = `${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`
        round.params = params // 存下来，「重新生成」要用同一套参数
        round.usage = ByChatAPI.combineImageUsage(plan.usage, result.usage)
        delete round.error
      }
      // 先保留已经成功的图片，再报告失败，不能丢掉已完成的结果。
      signal.throwIfAborted()
      if (!ids.length || result.errors?.length) {
        const detail = result.errors?.filter(Boolean).join('；')
        throw new Error(detail || tr("接口没有返回图片"))
      }
      await persistConversations(true)
    }
    if (round) delete round.phase
    clearRunningRound()
    if (c && c.id === activeId) renderChatView()
    renderList()
    await persistConversations()
    if (count) showToast(tr("生成完成，共 {0} 张", count), 'success')
    notifyTaskCompleted(c, count)
  } catch (err) {
    // 判定「用户取消」不能只看 err.name：Firefox 的 AbortError message 是
    // "NetworkError when attempting to fetch resource."，会被误报成网络故障。
    // 以我们自己 AbortController 的状态为准，最可靠。
    if ((signal && signal.aborted) || (err && err.name === 'AbortError')) {
      if (round) {
        delete round.phase
        round.cancelled = true
        if (runningRoundKind === 'chat') {
          round.text = streamingText
          round.reasoning = streamingReasoning
        }
        round.duration = `${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`
        delete round.error
      }
      clearRunningRound()
      if (c && c.id === activeId) renderChatView()
      await persistConversations()
      showToast(tr("已取消本次生成"), 'info')
      return // 用户主动取消，不当成失败
    }
    const msg = (err && err.message) ? err.message : tr("生成失败")
    // 中转站的模型列表会动态变化，选中的模型很可能这一刻已经不可用了
    let friendly = msg
    if (/not supported|does not exist/i.test(msg)) {
      friendly = tr("该模型当前不可用，请在设置里重新「获取模型」后再试")
    } else if (/NetworkError|Failed to fetch|Load failed|ERR_CONNECTION/i.test(msg)) {
      // 浏览器完全没拿到响应。最常见的原因其实有两个，别只报「后端没启动」：
      //   1) 后端确实没在跑
      //   2) 页面地址和后端端口对不上（比如后端起在 7400，页面还开在 7399）
      // 把当前页面地址一起报出来，用户一眼就能看出是哪种。
      friendly = tr("请求发不出去：浏览器连不上 {0}。\n", location.origin)
        + tr('请确认：① 后端正在运行；② 页面地址里的端口和后端端口一致。\n')
        + tr("原始错误：{0}", msg)
      // 顺手再探一次：后端要是真挂了，页面顶部会直接挂出红条，
      // 不用等用户下次刷新才发现问题。
      probeBackend()
    } else {
      // 请求到了后端还是失败 —— 多半是上游的锅。体检在后台跑，
      // 结论稍后自己长到气泡下面（见 diagnoseInto）。
      // 出图任务探生图口、聊天任务探聊天口，别拿生图模型去探聊天口。
      // 直连通道下请求压根没经过本站，体检后端没有意义，跳过。
      // 4xx 说明后端把源站的确凿结论原样传回来了（比如内容审核不通过），
      // 不是"连不上/说不清是谁的问题"，体检只会白白多等几十秒还给出无关的
      // 结论（比如探测用的测试图正常，反而让人误以为原始请求也该成功）。
      const viaProxy = !window.ByChatAPI
        || ByChatAPI.transportName({ baseUrl: profile.url }) === 'proxy'
      const isDefiniteOriginRejection = typeof err?.status === 'number' && err.status >= 400 && err.status < 500
      if (viaProxy && awaitingUpstream && requestKind !== 'image-plan' && !isDefiniteOriginRejection) {
        diagnoseInto(profile, requestModel, requestKind, round, c)
      }
    }
    if (round) {
      delete round.phase
      round.error = friendly
      if (runningRoundKind === 'chat') {
        round.text = streamingText
        round.reasoning = streamingReasoning
      }
      if (!count) delete round.images
    }
    clearRunningRound()
    if (c && c.id === activeId) renderChatView()
    await persistConversations()
    showToast(friendly, 'error')
  } finally {
    stopRunning()
    skel.style.display = 'none'
  }
}

/* 重新生成：沿用本轮参数。 */
async function retryRound(i) {
  const c = conversations.find((x) => x.id === activeId)
  if (!c) return
  const rounds = conversationRounds(c)
  const r = rounds[i]
  if (!r) { showToast(tr("找不到该轮记录"), 'error'); return }
  if (isRunning) { showToast(tr("还有任务在生成中"), 'info'); return }
  const params = { ...(r.params || buildParams(r.prompt)) }

  // 先把这一轮退回「生成中」：清掉旧结果，气泡立刻变成转圈
  r.images = []
  r.text = ''
  r.reasoning = ''
  delete r.error
  delete r.cancelled
  r.duration = ''
  r.sentAt = nowStamp()
  setRunningRound(c, r, taskKindFor(params.model))
  stickBottom()
  renderChatView()
  scrollChatToBottom()
  await doGenerate(r.prompt, params, c, r)
}

/** 原型的 inputImages 存的是 DataURL，而改图接口要 File 对象，这里转一下 */
function dataUrlToFile(dataUrl, name) {
  const parts = String(dataUrl).split(',')
  const mime = (/:([^;]+);/.exec(parts[0] || '') || [, 'image/png'])[1]
  const bin = atob(parts[1] || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: mime })
}
/** abort=true 时连在飞的请求一起取消（用户点发送键中止） */
function stopRunning(abort) {
  isRunning = false
  if (abort && currentAbort) {
    try { currentAbort.abort() } catch { /* 已经结束就算了 */ }
  }
  currentAbort = null
  const btn = document.getElementById('sendBtn')
  const icon = document.getElementById('sendIcon')
  btn.classList.remove('is-running')
  icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14m-7-7l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5" />'
}

function cancelGeneration(button) {
  if (!currentAbort || !isRunning) return
  if (button) button.disabled = true
  // 停止后保留尚未发送的草稿，以及当前已经收到的回复。
  if (pendingInputs.length) {
    const draft = [promptInput.value.trim(), ...pendingInputs.map((task) => typeof task === 'string' ? task : task.prompt)].filter(Boolean).join('\n')
    promptInput.value = draft
    promptInput.dispatchEvent(new Event('input', { bubbles: true }))
    pendingInputs = []
  }
  currentAbort.abort()
}

/* =====================================================
   设置弹窗：API 配置 / 习惯配置
   ===================================================== */
const DEFAULT_API_URL = 'https://api.bingyun.vip/v1'
const SETTINGS_TABS = [
  { id: 'api', label: 'API 配置' },
  { id: 'general', label: '习惯配置' },
]

// 内部审核模型不作为用户模型展示；同时适用于新获取的列表和旧缓存。
function isVisibleModel(model) {
  return String(model.id || '').trim().toLowerCase() !== 'codex-auto-review'
}

const S = {
  open: false,
  tab: 'api',
  scroll: {},
  profiles: [
    {
      id: 'p1',
      name: '冰云默认',
      url: DEFAULT_API_URL,
      key: '', // 留空：Key 必须由用户自己填，服务端不保存任何副本
      fetched: false,
      models: [], // 填好 Key 点「获取模型」后填入真实列表，不再预置假模型
    },
  ],
  activeId: 'p1',
  adding: false,
  draft: null,
  keyVisible: false,
  editingModel: -1,
  editDraft: { id: '', name: '' },
  fetching: false,
  /* 用户是否手动选过模型：没手动选过就始终用默认（生图模型 / sunburst），
     手动选过之后才尊重用户的选择 */
  modelPinned: false,
}

/* 仅保留实际生效的偏好；版本号用于迁移旧版未接通的开关。 */
const GENERAL_DEFAULTS = {
  clearInputAfterSubmit: true,
  persistInputOnRestart: true,
  taskCompletionNotification: true,
}
const G = { ...GENERAL_DEFAULTS }
function generalSettingsOf(value = {}) {
  const result = { ...GENERAL_DEFAULTS }
  for (const key of Object.keys(result)) {
    if (typeof value[key] === 'boolean' && (value.version === 2 || key === 'persistInputOnRestart')) result[key] = value[key]
  }
  return result
}

const ICON_X = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
const ICON_CARET = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>'
const ICON_EYE = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'
const ICON_EYE_OFF = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>'
const ICON_PENCIL = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>'
const ICON_TRASH = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>'
const ICON_CHECK = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.6"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
const ICON_REFRESH = '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>'

function activeProfile() {
  return S.profiles.find((p) => p.id === S.activeId) || S.profiles[0]
}
function currentProfile() {
  return S.adding ? S.draft : activeProfile()
}
function profileName(profile) {
  return profile.id === 'p1' && profile.name === '冰云默认' && !profile.nameEdited ? tr('冰云默认') : profile.name
}
/* 注：syncComposerModels 已在「参数 pill」区统一实现（模型展示名称、保存 id） */

/* ---------- 弹窗骨架 ---------- */
function openSettings() {
  S.open = true
  renderSettings()
  document.addEventListener('keydown', onModalKey)
}
function closeSettings() {
  setKeyVisibility(false)
  S.open = false
  document.removeEventListener('keydown', onModalKey)
  const layer = document.getElementById('modalLayer')
  const root = document.getElementById('settingsRoot')
  if (layer) {
    layer.classList.remove('show')
    setTimeout(() => { if (!S.open) root.innerHTML = '' }, 220)
  } else {
    root.innerHTML = ''
  }
}
function onModalKey(e) {
  if (e.key === 'Escape') closeSettings()
}
function switchTab(tab) {
  if (!SETTINGS_TABS.some((item) => item.id === tab)) return
  const body = document.getElementById('modalBody')
  if (body) S.scroll[S.tab] = body.scrollTop
  S.tab = tab
  S.editingModel = -1
  renderSettings()
}
function renderSettings() {
  const root = document.getElementById('settingsRoot')
  if (!root || !S.open) return
  // 查看只对当前输入框临时生效，重开、切换配置或更新面板后均恢复打码。
  S.keyVisible = false

  // 弹层已存在时只替换内容区，不重建整个弹层。
  // 重建会让 .show 的淡入动画被重新播放一遍 —— 那就是「点什么都会闪一下」的原因。
  const layer = document.getElementById('modalLayer')
  if (layer) {
    const body = document.getElementById('modalBody')
    if (body) {
      const keep = body.scrollTop
      body.innerHTML = tabHtml()
      body.scrollTop = keep
    }
    root.querySelectorAll('.modal-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === S.tab)
    })
    return
  }

  root.innerHTML = `
    <div class="modal-layer" id="modalLayer" onclick="if(event.target.id==='modalLayer') closeSettings()">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title" data-i18n="设置">${escapeHtml(tr("设置"))}</div>
          <button class="modal-close" onclick="closeSettings()" title="${escapeHtml(tr("关闭"))}" data-i18n-title="关闭">${ICON_X}</button>
        </div>
        <div class="modal-tabs">
          ${SETTINGS_TABS.map((tab) => `<button class="modal-tab ${S.tab === tab.id ? 'is-active' : ''}" data-tab="${tab.id}" data-i18n="${tab.label}" onclick="switchTab('${tab.id}')">${escapeHtml(tr(tab.label))}</button>`).join('')}
        </div>
        <div class="modal-body" id="modalBody">${tabHtml()}</div>
      </div>
    </div>`
  requestAnimationFrame(() => {
    const l = document.getElementById('modalLayer')
    if (l) l.classList.add('show')
    const b = document.getElementById('modalBody')
    if (b) b.scrollTop = S.scroll[S.tab] || 0
  })
}
function tabHtml() {
  if (S.tab === 'general') return renderGeneralTab()
  return renderApiTab()
}

/* ---------- API 配置 ---------- */

/** Key 一律打码显示。api.js 是 module，这里包一层给内联模板用。 */
function maskKey(key) {
  return (window.ByChatAPI && ByChatAPI.maskKey) ? ByChatAPI.maskKey(key) : ''
}

function renderApiTab() {
  const p = currentProfile()
  const isNew = S.adding
  return `
    <div class="api-card">
      <div class="chips-row">
        ${S.profiles.map((x) => `
          <button class="chip ${!isNew && x.id === S.activeId ? 'is-active' : ''}" onclick="selectProfile('${x.id}')">
            <span class="chip-dot"></span>${escapeHtml(profileName(x))}
            ${S.profiles.length > 1 ? `<span class="chip-x" onclick="event.stopPropagation();removeProfile('${x.id}')" title="${escapeHtml(tr("删除配置"))}" data-i18n-title="删除配置">×</span>` : ''}
          </button>`).join('')}
        <button class="chip chip-add" onclick="startAddProfile()">${escapeHtml(tr("+ 添加配置"))}</button>
      </div>
    </div>

    <div class="api-card api-profile-card">
      <div class="field">
        <label class="field-label">${escapeHtml(tr("配置名称"))}<span class="req">*</span><span class="hint-inline">${escapeHtml(tr("唯一，用于区分不同配置"))}</span></label>
        <input class="field-input" value="${escapeHtml(profileName(p))}" placeholder="${escapeHtml(tr("例如：冰云默认"))}" oninput="onProfileInput('name', this.value)" />
      </div>
      <div class="field">
        <label class="field-label">API URL</label>
        <input class="field-input" value="${escapeHtml(p.url)}" placeholder="${DEFAULT_API_URL}" oninput="onProfileInput('url', this.value)" />
      </div>
      <div class="field">
        <label class="field-label" for="cfgKey">API Key<span class="tag">${escapeHtml(tr("仅存本机"))}</span></label>
        <div class="field-row">
          <input class="field-input" id="cfgKey" type="password" value="${escapeHtml(p.key || '')}" placeholder="sk-..." autocomplete="off" spellcheck="false" autocapitalize="off" onfocus="editProfileKey()" oninput="onProfileInput('key', this.value)" />
          <button type="button" class="btn-outline" data-act="toggle-key" style="width:44px;justify-content:center;padding:0;flex:none" onclick="toggleKeyView()" title="${escapeHtml(tr("显示 API Key 摘要"))}" data-i18n-title="显示 API Key 摘要" aria-label="${escapeHtml(tr("显示 API Key 摘要"))}" data-i18n-aria-label="显示 API Key 摘要" aria-controls="cfgKey" aria-pressed="false">${ICON_EYE}</button>
          <div class="api-profile-actions">
            ${isNew ? `<button class="btn-outline" onclick="cancelAddProfile()">${escapeHtml(tr("取消"))}</button>` : ''}
            <button class="btn-primary-sm" style="height:38px;padding:0 18px;font-size:13px" onclick="saveProfile()">${isNew ? tr("保存并获取模型") : tr("保存配置")}</button>
          </div>
        </div>
        <div class="field-hint">
          ${p.key ? `${escapeHtml(tr("已填写："))}<code>${escapeHtml(maskKey(p.key))}</code> · ` : ''}${escapeHtml(tr("密钥仅保存在本机浏览器，发送请求时用于身份验证。"))}
        </div>
      </div>
    </div>

    ${modelSectionHtml(p, isNew)}`
}

function modelSectionHtml(p, isNew) {
  const modelCount = p.models.filter(isVisibleModel).length
  const rows = p.models.map((m, i) => {
    // 保留原索引，让旧缓存中隐藏模型之后的编辑、删除仍对应正确条目。
    if (!isVisibleModel(m)) return ''
    if (S.editingModel === i) {
      return `<div class="edit-row">
        <input class="field-input" value="${escapeHtml(S.editDraft.id)}" placeholder="${escapeHtml(tr("模型 id"))}" oninput="onEditDraft('id', this.value)" />
        <input class="field-input" value="${escapeHtml(S.editDraft.name)}" placeholder="${escapeHtml(tr("模型名称"))}" oninput="onEditDraft('name', this.value)" />
        <div class="model-actions">
          <button class="icon-mini" onclick="saveModelName()" title="${escapeHtml(tr("保存"))}" data-i18n-title="保存">${ICON_CHECK}</button>
          <button class="icon-mini danger" onclick="cancelEditModel()" title="${escapeHtml(tr("取消"))}" data-i18n-title="取消">${ICON_X}</button>
        </div>
      </div>`
    }
    return `<div class="model-row">
      <span class="model-cell mono" title="${escapeHtml(m.id)}">${escapeHtml(m.id)}</span>
      <span class="model-cell" title="${escapeHtml(m.name)}">${escapeHtml(m.name)}</span>
      <div class="model-actions">
        <button class="icon-mini" onclick="startEditModel(${i})" title="${escapeHtml(tr("修改模型名称"))}" data-i18n-title="修改模型名称">${ICON_PENCIL}</button>
        <button class="icon-mini danger" onclick="removeModel(${i})" title="${escapeHtml(tr("删除模型"))}" data-i18n-title="删除模型">${ICON_TRASH}</button>
      </div>
    </div>`
  }).join('')

  return `
    <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span style="display:inline-flex;align-items:center">${escapeHtml(tr("模型列表"))}<span class="count">${modelCount}</span></span>
      ${isNew ? '' : `<button class="btn-link" onclick="fetchModels()" title="${escapeHtml(tr("从当前接口重新拉取模型"))}" data-i18n-title="从当前接口重新拉取模型" ${S.fetching ? 'disabled' : ''}>
        <span class="btn-link-ic ${S.fetching ? 'is-spin' : ''}">${ICON_REFRESH}</span>${S.fetching ? tr("正在获取…") : tr("重新获取")}
      </button>`}
    </div>
    ${modelCount
      ? `<div class="model-table">
          <div class="model-table-head"><span>${escapeHtml(tr("模型 id"))}</span><span>${escapeHtml(tr("模型名称"))}</span><span class="th-op">${escapeHtml(tr("操作"))}</span></div>
          ${rows}
        </div>`
      : `<div class="empty-models">${S.adding ? tr("填写 API Key 并保存后将自动获取模型列表") : tr("暂无模型，点击「重新获取」获取模型列表")}</div>`}`
}

/* API 配置交互 */
function onProfileInput(field, value) {
  // 只读摘要不能覆盖用于保存和请求的完整 Key。
  if (field === 'key' && S.keyVisible) return
  const p = currentProfile()
  p[field] = value
  if (field === 'name') p.nameEdited = true
  // 已存在的配置边输入边保存；即使用户直接刷新，也不会丢掉刚填写的 Key。
  if (!S.adding) scheduleSettingsSave()
}
/* 眼睛只显示打码摘要；完整 Key 仅在密码输入状态下编辑。 */
function setKeyVisibility(visible) {
  S.keyVisible = !!visible
  const input = document.getElementById('cfgKey')
  if (input) {
    const key = currentProfile().key || ''
    if (S.keyVisible) {
      // 先替换内容再切换类型，任何时候都不以明文展示完整 Key。
      input.value = maskKey(key)
      input.readOnly = true
      input.type = 'text'
    } else {
      input.type = 'password'
      input.value = key
      input.readOnly = false
    }
  }
  const btn = document.querySelector('[data-act="toggle-key"]')
  if (btn) {
    btn.title = S.keyVisible ? tr("隐藏 API Key 摘要") : tr("显示 API Key 摘要")
    btn.setAttribute('aria-label', btn.title)
    btn.setAttribute('aria-pressed', String(S.keyVisible))
    btn.innerHTML = S.keyVisible ? ICON_EYE_OFF : ICON_EYE
  }
}
function toggleKeyView() { setKeyVisibility(!S.keyVisible) }
function editProfileKey() {
  if (!S.keyVisible) return
  setKeyVisibility(false)
  document.getElementById('cfgKey')?.select()
}
function selectProfile(id) {
  S.adding = false
  S.activeId = id
  S.editingModel = -1
  syncComposerModels()
  persistSettings()
  renderSettings()
}
function startAddProfile() {
  S.adding = true
  S.draft = { id: 'p' + Date.now(), name: '', url: DEFAULT_API_URL, key: '', fetched: false, models: [] }
  S.editingModel = -1
  renderSettings()
  setTimeout(() => {
    const el = document.querySelector('#modalBody .field-input')
    if (el) el.focus()
  }, 60)
}
function cancelAddProfile() { S.adding = false; S.draft = null; renderSettings() }
async function saveProfile() {
  setKeyVisibility(false)
  const p = currentProfile()
  if (!p.name.trim()) { showToast(tr("请填写配置名称"), 'error'); return }
  const dup = S.profiles.some((x) => x.name.trim() === p.name.trim() && x.id !== p.id)
  if (dup) { showToast(tr("配置名称已存在，请更换"), 'error'); return }
  if (!p.url.trim()) { showToast(tr("请填写 API URL"), 'error'); return }

  if (S.adding) {
    S.profiles.push({ ...p, id: 'p' + crypto.randomUUID(), models: p.models || [] })
    S.activeId = S.profiles[S.profiles.length - 1].id
    S.adding = false
    S.draft = null
    renderSettings()
  }
  const saved = await persistSettings()
  if (!saved) return
  if (activeProfile().key && activeProfile().key.trim()) await fetchModels()
  else { syncComposerModels(); renderSettings(); showToast(tr("配置已保存到本机"), 'success') }
}
async function removeProfile(id) {
  if (S.profiles.length <= 1) { showToast(tr("至少保留一个配置"), 'error'); return }
  const p = S.profiles.find((x) => x.id === id)
  const ok = await askConfirm({ title: () => tr("删除配置"), desc: () => tr("确定要删除配置「{0}」吗？该配置下的模型列表也会一并移除。", p ? profileName(p) : ''), confirmText: () => tr("删除") })
  if (!ok) return
  S.profiles = S.profiles.filter((x) => x.id !== id)
  if (S.activeId === id) S.activeId = S.profiles[0].id
  syncComposerModels()
  renderSettings()
  if (await persistSettings()) showToast(tr("配置已删除"), 'success')
}
/* 真实拉取：走自己的后端透传（Key 放在请求头里带给后端，用完即弃） */
async function fetchModels() {
  const p = activeProfile()
  if (!p) return
  if (!p.key || !p.key.trim()) { showToast(tr("请先填写 API Key"), 'error'); return }
  if (S.fetching) return
  S.fetching = true
  renderSettings()
  showToast(tr("正在获取模型列表…"), 'info')
  try {
    const list = await ByChatAPI.fetchModels({ baseUrl: p.url, apiKey: p.key })
    p.models = list.filter(isVisibleModel).map((m) => ({ ...m, name: m.name || m.id }))
    p.fetched = true
    p.fetchedAt = Date.now()
    syncComposerModels()
    renderSettings()
    if (await persistSettings()) showToast(tr("已获取 {0} 个模型", p.models.length), 'success')
  } catch (err) {
    showToast(err && err.message ? err.message : tr("获取模型失败"), 'error')
  } finally {
    S.fetching = false
    renderSettings()
  }
}
function startEditModel(i) {
  const p = currentProfile()
  S.editingModel = i
  S.editDraft = { id: p.models[i].id, name: p.models[i].name }
  renderSettings()
}
function cancelEditModel() { S.editingModel = -1; renderSettings() }
function onEditDraft(field, value) { S.editDraft[field] = value }
async function saveModelName() {
  const p = currentProfile()
  const i = S.editingModel
  const id = S.editDraft.id.trim()
  const name = S.editDraft.name.trim()
  if (!id) { showToast(tr("模型 id 不能为空"), 'error'); return }
  if (p.models.some((m, k) => k !== i && m.id === id)) { showToast(tr("该模型 id 已存在"), 'error'); return }
  p.models[i] = { ...p.models[i], id, name: name || id }
  S.editingModel = -1
  syncComposerModels()
  renderSettings()
  if (await persistSettings()) showToast(tr("模型已更新"), 'success')
}
async function removeModel(i) {
  const p = currentProfile()
  const m = p.models[i]
  const ok = await askConfirm({ title: () => tr("删除模型"), desc: () => tr("确定删除 {0} 吗？", m.name || m.id), confirmText: () => tr("删除") })
  if (!ok) return
  p.models.splice(i, 1)
  S.editingModel = -1
  syncComposerModels()
  renderSettings()
  if (await persistSettings()) showToast(tr("模型已删除"), 'success')
}
/* ---------- 习惯配置（照搬 gpt_image_playground） ---------- */
function gsRow(key, title, desc) {
  return `<div class="switch-row">
    <div class="switch-main">
      <div class="switch-title">${title}</div>
      <div class="switch-desc">${desc}</div>
    </div>
    <button class="switch ${G[key] ? 'on' : ''}" onclick="toggleG('${key}')" aria-label="${title}"></button>
  </div>`
}
function toggleG(key) {
  if (!(key in GENERAL_DEFAULTS)) return
  G[key] = !G[key]
  if (key === 'taskCompletionNotification' && G[key]) requestTaskNotificationPermission()
  persistComposerDraft()
  persistSettings()
  renderSettings()
}
function renderGeneralTab() {
  return `
    ${gsRow('clearInputAfterSubmit', tr("提交任务后清空输入框"), tr("默认开启。提交后清空提示词和参考图；关闭后保留，方便继续修改。"))}
    ${gsRow('persistInputOnRestart', tr("重启后加载上次的输入框"), tr("保存尚未发送的提示词和参考图，下次打开时恢复。"))}
    ${gsRow('taskCompletionNotification', tr("任务完成后发送系统通知"), tr("默认开启。首次发送时申请浏览器通知权限，任务完成后提醒。"))}`
}

let notificationPermissionRequested = false
function requestTaskNotificationPermission() {
  if (!G.taskCompletionNotification || !('Notification' in window)) return
  if (Notification.permission !== 'default' || notificationPermissionRequested) return
  notificationPermissionRequested = true
  try {
    Promise.resolve(Notification.requestPermission()).then((permission) => {
      if (permission === 'denied') showToast(tr("浏览器未允许系统通知，可在站点权限中开启"), 'info')
    }).catch(() => {})
  } catch { /* 浏览器不支持通知时，不影响任务发送。 */ }
}
function notifyTaskCompleted(c, imageCount) {
  if (!G.taskCompletionNotification || !('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const notification = new Notification(imageCount ? tr("图片已完成") : tr("回复已完成"), {
      body: imageCount ? tr("已完成 {0} 张图片，点击查看", imageCount) : tr("点击查看完整回复"),
      icon: 'assets/logo.png',
      tag: `bychat-${c?.id ?? 'task'}`,
    })
    notification.onclick = () => {
      window.focus()
      if (c && conversations.some((item) => item.id === c.id)) selectConversation(c.id)
      notification.close()
    }
  } catch { /* 操作系统可能屏蔽通知，任务结果仍正常保留。 */ }
}

/* =====================================================
   主题切换
   ===================================================== */
/* 太阳 / 月亮图标：跟随主题切换 */
const ICON_SUN = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.364-6.364l-1.414 1.414M7.05 16.95l-1.414 1.414m12.728 0l-1.414-1.414M7.05 7.05L5.636 5.636M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>'
const ICON_MOON = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>'
function syncThemeIcon() {
  const icon = document.getElementById('themeIcon')
  if (!icon) return
  icon.innerHTML = darkMode ? ICON_SUN : ICON_MOON
  const button = document.getElementById('themeToggleBtn')
  if (button) {
    button.dataset.i18nTitle = darkMode ? '切换到浅色模式' : '切换到深色模式'
    button.title = tr(button.dataset.i18nTitle)
    button.setAttribute('aria-label', button.title)
  }
}
function toggleTheme() {
  darkMode = !darkMode
  document.documentElement.classList.toggle('dark', darkMode)
  document.body.classList.toggle('dark', darkMode)
  syncThemeIcon()
  const btn = document.getElementById('themeToggleBtn')
  if (btn) btn.title = darkMode ? tr("切换到浅色模式") : tr("切换到深色模式")
  persistSettings()
  showToast(darkMode ? tr("已切换到深色模式") : tr("已切换到浅色模式"), 'info')
}

function toggleLanguage() {
  ByImageI18n.setLanguage(ByImageI18n.language === 'en' ? 'zh-CN' : 'en')
}

function refreshLanguage() {
  hideToast()
  const scrolls = ['.content', '#convList', '#modalBody', '#sizeLayer .size-body', '#historyPanel']
    .map((selector) => ({ selector, top: document.querySelector(selector)?.scrollTop || 0 }))
  const active = document.activeElement
  const inputScope = active?.closest('#settingsRoot, #sizeRoot, #convList')
  const inputIndex = inputScope ? Array.from(inputScope.querySelectorAll('input')).indexOf(active) : -1
  const selection = inputIndex < 0 ? null : { start: active.selectionStart, end: active.selectionEnd }
  const keyVisible = S.keyVisible
  if (active?.dataset.rename) renamingValue = active.value
  if (active?.dataset.grename) renamingGroupValue = active.value
  // Parameter chips are editable without changing the stored prompt.
  const argumentsDraft = Array.from(document.querySelectorAll('#chatView .arg-chip'), (el) => ({
    round: el.closest('[data-round]').dataset.round,
    index: el.dataset.argumentIndex,
    value: el.querySelector('input')?.value ?? el.dataset.value,
    editing: el.contains(active) && active.tagName === 'INPUT',
    start: el.contains(active) ? active.selectionStart : null,
    end: el.contains(active) ? active.selectionEnd : null,
  }))

  renderList()
  renderMultiBar()
  syncTitle()
  renderChatView()
  for (const item of argumentsDraft) {
    const chip = document.querySelector(`#round-${item.round} [data-argument-index="${item.index}"]`)
    if (chip) {
      chip.dataset.value = item.value
      chip.querySelector('.arg-value').textContent = item.value
      if (item.editing) {
        editArgument({ stopPropagation() {} }, chip)
        chip.querySelector('input').setSelectionRange(item.start, item.end)
      }
    }
  }
  syncModelCapabilities()
  refreshPill('model')
  renderPillMenu('model')
  renderInputImages()
  if (S.open) { renderSettings(); setKeyVisibility(keyVisible) }
  if (SZ.open) {
    renderSizePicker()
    document.querySelector('#sizeLayer .modal-sub').textContent = tr('当前：{0}', currentSize || 'auto')
  }
  if (!document.getElementById('historyPanel').hidden) renderHistoryPanel()
  const theme = document.getElementById('themeToggleBtn')
  theme.title = tr(darkMode ? '切换到浅色模式' : '切换到深色模式')
  theme.setAttribute('aria-label', theme.title)
  promptInput.querySelectorAll('[data-language]').forEach((el) => {
    if (['代码', 'Code'].includes(el.dataset.language)) el.dataset.language = tr('代码')
  })
  if (inputIndex >= 0) {
    const input = inputScope.querySelectorAll('input')[inputIndex]
    input?.focus({ preventScroll: true })
    if (selection?.start != null && input?.type !== 'number') input.setSelectionRange(selection.start, selection.end)
  } else if (active?.isConnected) active.focus({ preventScroll: true })
  for (const { selector, top } of scrolls) {
    const el = document.querySelector(selector)
    if (el) el.scrollTop = top
  }
  syncLatestButton()
}
window.addEventListener('byimage:languagechange', refreshLanguage)

/* =====================================================
   启动
   ===================================================== */
const promptInput = document.getElementById('promptInput')
const promptEditor = window.ByChatComposer.createMarkdownEditor(promptInput, {
  shouldSubmit: (event) => !event.shiftKey,
  onSubmit: () => { void handleSend() },
})
window.ByChatResize.createComposerResizer({
  composer: document.getElementById('composer'),
  area: document.getElementById('composerArea'),
  handle: document.getElementById('composerResizeHandle'),
  toolbar: document.querySelector('.main > .toolbar'),
})

/* 输入框：粘贴/拖入图片作为参考图 */
let inputImages = []

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error(tr("读取失败")))
    r.readAsDataURL(file)
  })
}
async function addInputImageFromFile(file, expectedConversationId = null) {
  if (!parameterApplicable('attach')) return false
  if (!file || !file.type.startsWith('image/')) return false
  try {
    const url = await fileToDataUrl(file)
    if (!parameterApplicable('attach')) return false
    if (expectedConversationId != null && expectedConversationId !== activeId) return false
    if (inputImages.length >= MAX_INPUT_IMAGES) {
      showToast(tr("最多只能添加 {0} 张参考图", MAX_INPUT_IMAGES), 'info')
      return false
    }
    inputImages.push(url)
    const idx = inputImages.length
    if (!promptInput.value.endsWith(' ') && promptInput.value) promptInput.value += ' '
    promptInput.value += `@${idx} `
    promptInput.dispatchEvent(new Event('input', { bubbles: true }))
    renderInputImages()
    return true
  } catch (e) {
    showToast(tr("图片读取失败"), 'error')
    return false
  }
}
function removeInputImage(i) {
  inputImages.splice(i, 1)
  renderInputImages()
  showToast(tr("已移除参考图 {0}", i + 1), 'info')
}

/* ===== 上传参考图 ===== */
const MAX_INPUT_IMAGES = 8

function openImagePicker() {
  if (!parameterApplicable('attach')) return
  const input = document.getElementById('imageFileInput')
  if (!input) return
  if (inputImages.length >= MAX_INPUT_IMAGES) {
    showToast(tr("最多只能添加 {0} 张参考图", MAX_INPUT_IMAGES), 'info')
    return
  }
  input.value = ''
  input.click()
}

async function handleImageFiles(fileList) {
  if (!parameterApplicable('attach')) { showToast(tr("当前模型不支持参考图（OpenRouter 未标注它支持图像输入）"), 'info'); return }
  const files = Array.from(fileList || []).filter((f) => f && f.type.startsWith('image/'))
  if (files.length === 0) {
    showToast(tr("请选择图片文件"), 'info')
    return
  }
  const room = MAX_INPUT_IMAGES - inputImages.length
  if (room <= 0) {
    showToast(tr("最多只能添加 {0} 张参考图", MAX_INPUT_IMAGES), 'info')
    return
  }
  const picked = files.slice(0, room)
  let added = 0
  for (const file of picked) {
    if (await addInputImageFromFile(file)) added += 1
  }
  if (added > 0) {
    showToast(tr("已添加 {0} 张参考图", added), 'success')
    if (files.length > picked.length) showToast(tr("最多 {0} 张，已忽略多余图片", MAX_INPUT_IMAGES), 'info')
  } else {
    showToast(tr("没有可添加的图片"), 'error')
  }
}

document.getElementById('imageFileInput').addEventListener('change', (e) => {
  const files = e.target.files
  e.target.value = ''   // 允许重复选同一个文件
  void handleImageFiles(files)
})
function renderInputImages() {
  scheduleDraftSave()
  const wrap = document.getElementById('composerImages')
  if (!wrap) return
  if (!inputImages.length) { wrap.hidden = true; wrap.innerHTML = ''; return }
  wrap.hidden = false
  /* 每张参考图就是提示词里的 @1 / @2 …：
     角标写出来 + 点一下能放大，免得写 @1 时不知道指的是哪张。 */
  wrap.innerHTML = inputImages.map((url, i) => `<div class="ci-thumb" title="${escapeHtml(tr("点击放大查看（提示词里用 @{0} 引用这张）", i + 1))}" onclick="openInputImage(${i})">
    <img src="${url}" alt="${escapeHtml(tr("参考图 @{0}", i + 1))}" />
    <span class="ci-thumb-idx">@${i + 1}</span>
    <button class="ci-thumb-x" onclick="event.stopPropagation();removeInputImage(${i})" title="${escapeHtml(tr("移除"))}" data-i18n-title="移除">${ICON_X}</button>
  </div>`).join('')
}
/** 点输入区的参考图 → 放大看清楚是哪一张（对应提示词里的 @N） */
function openInputImage(i) {
  const url = (typeof inputImages !== 'undefined') ? inputImages[i] : null
  if (url) openLightbox(url)
}
promptInput.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile()).filter(Boolean)
  if (!files.length) return
  event.preventDefault()
  void handleImageFiles(files)
})
promptInput.addEventListener('dragover', (event) => { event.preventDefault() })
promptInput.addEventListener('drop', (event) => {
  event.preventDefault()
  const files = Array.from(event.dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'))
  if (files.length) void handleImageFiles(files)
  else {
    const text = event.dataTransfer?.getData('text/plain')
    if (text) promptEditor.insertText(text)
  }
})


renderList()
syncTitle()
renderChatView()
syncComposerModels()
refreshSizePill()

/* =====================================================
   本机持久化
   会话和图片存 IndexedDB；API 配置等小设置另有 localStorage 镜像。
   服务器不留任何副本。
   ===================================================== */
let persistenceToastAt = 0
function reportPersistenceError(error, action = tr("保存本机数据")) {
  console.error(`${action}失败：`, error)
  const now = Date.now()
  if (now - persistenceToastAt > 2500) {
    const detail = error?.name === 'StorageConflictError' ? error.message : /quota|space|容量|空间/i.test(String(error?.message || ''))
      ? tr("浏览器存储空间不足，请清理站点数据或磁盘空间后重试。")
      : tr("浏览器未能写入本机存储，请检查隐私模式或站点存储权限。")
    showToast(tr("{0}失败：{1}", action, detail), 'error')
    persistenceToastAt = now
  }
  return false
}

async function persistConversations(strict = false) {
  if (window.ByChatDB?.syncConversations && !window.ByChatStorageReady) return false
  if (!window.ByChatDB) {
    const error = new Error(tr("本机数据库尚未加载"))
    if (strict) throw error
    return reportPersistenceError(error, tr("保存对话"))
  }
  const task = async () => {
    try {
      const saveRows = typeof window.ByChatDB.syncConversations === 'function'
        ? window.ByChatDB.syncConversations(conversations)
        : Promise.all(conversations.map((c) => window.ByChatDB.putConversation(c)))
      const [removedImages] = await Promise.all([
        saveRows,
        window.ByChatDB.setSetting('groups', groupDefs),
        window.ByChatDB.setSetting('activeConversationId', activeId),
      ])
      if (window.ByChatDB.syncConversations) {
        for (const id of removedImages || []) {
          const url = IMAGE_URLS.get(id)
          if (url) URL.revokeObjectURL(url)
          IMAGE_URLS.delete(id)
        }
      }
      return true
    } catch (error) {
      if (strict) throw error
      return reportPersistenceError(error, tr("保存对话"))
    }
  }
  const state = window.__ByChatPersistence || (window.__ByChatPersistence = {
    conversationQueue: Promise.resolve(),
    settingsQueue: Promise.resolve(),
  })
  const result = state.conversationQueue.then(task, task)
  state.conversationQueue = result.catch(() => false)
  return result
}

async function persistActiveConversation(strict = false) {
  if (window.ByChatDB?.syncConversations && !window.ByChatStorageReady) return false
  if (!window.ByChatDB) {
    const error = new Error(tr("本机数据库尚未加载"))
    if (strict) throw error
    return reportPersistenceError(error, tr("保存当前对话"))
  }
  try {
    await window.ByChatDB.setSetting('activeConversationId', activeId)
    return true
  } catch (error) {
    if (strict) throw error
    return reportPersistenceError(error, tr("保存当前对话"))
  }
}

async function persistSettings(strict = false) {
  if (window.ByChatDB?.syncConversations && !window.ByChatSettingsReady) return false
  if (!window.ByChatDB) {
    const error = new Error(tr("本机数据库尚未加载"))
    if (strict) throw error
    return reportPersistenceError(error, tr("保存设置"))
  }
  const s = {
    profiles: S.profiles.map((p) => ({
      id: p.id, name: p.name, nameEdited: !!p.nameEdited, url: p.url, key: p.key,
      fetched: p.fetched, models: p.models || [], fetchedAt: p.fetchedAt || 0,
    })),
    activeId: S.activeId,
    modelPinned: S.modelPinned,
    parameters: { ...PILL_STATE },
    darkMode,
  }
  const values = {
    S: s,
    G: { version: 2, ...G },
    model: currentModel,
    size: currentSize,
  }
  const task = async () => {
    try {
      if (typeof window.ByChatDB.setSettings === 'function') await window.ByChatDB.setSettings(values)
      else await Promise.all(Object.entries(values).map(([key, value]) => window.ByChatDB.setSetting(key, value)))
      return true
    } catch (error) {
      if (strict) throw error
      return reportPersistenceError(error, tr("保存设置"))
    }
  }
  return task()
}

let draftSaveTimer = null
async function persistComposerDraft(strict = false) {
  if (window.ByChatDB?.syncConversations && !window.ByChatStorageReady) return false
  clearTimeout(draftSaveTimer)
  if (!window.ByChatDB) {
    const error = new Error(tr("本机数据库尚未加载"))
    if (strict) throw error
    return reportPersistenceError(error, tr("保存输入草稿"))
  }
  try {
    if (G.persistInputOnRestart) {
      const draft = { prompt: promptInput.value, images: [...inputImages] }
      const snapshot = JSON.stringify(draft)
      if (window.__ByChatDraftSnapshot === snapshot) return true
      await ByChatDB.setSetting('composerDraft', draft)
      window.__ByChatDraftSnapshot = snapshot
    } else {
      await ByChatDB.deleteSetting('composerDraft')
      window.__ByChatDraftSnapshot = null
    }
    return true
  } catch (error) {
    if (strict) throw error
    return reportPersistenceError(error, tr("保存输入草稿"))
  }
}
function scheduleDraftSave() {
  clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(persistComposerDraft, 180)
}
let settingsSaveTimer = null
function scheduleSettingsSave() {
  clearTimeout(settingsSaveTimer)
  settingsSaveTimer = setTimeout(persistSettings, 180)
}
promptInput.addEventListener('input', scheduleDraftSave)

function flushLocalState() {
  clearTimeout(settingsSaveTimer)
  void persistSettings()
  if (!window.ByChatStorageReady) return
  clearTimeout(draftSaveTimer)
  void persistComposerDraft()
  void persistConversations()
}
window.addEventListener('pagehide', flushLocalState)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushLocalState()
})

let storageRefreshTimer = null
function scheduleStorageRefresh() {
  clearTimeout(storageRefreshTimer)
  storageRefreshTimer = setTimeout(refreshStorageSnapshot, 120)
}
async function refreshStorageSnapshot() {
  const busy = () => !window.ByChatStorageReady || isRunning || S.open || SZ.open || renamingId != null
    || renamingGroupKey != null || document.activeElement?.matches('input, textarea, [contenteditable="true"]')
  if (busy()) { storageRefreshTimer = setTimeout(refreshStorageSnapshot, 1000); return }
  const state = () => JSON.stringify([conversations, groupDefs, S.profiles, S.activeId, G, currentModel, currentSize, darkMode])
  try {
    if (!await persistSettings() || !await persistConversations()) return
    const before = state()
    const snapshot = await ByChatDB.readSnapshot()
    if (busy() || before !== state()) { scheduleStorageRefresh(); return }
    const saved = snapshot.settings
    ByChatDB.rememberSnapshot(snapshot)
    conversations = snapshot.rows
    if (!conversations.some((c) => c.id === activeId)) activeId = conversations[0]?.id ?? null
    conversations.forEach((c) => { c.active = c.id === activeId })
    if (saved.groups) groupDefs = saved.groups
    if (saved.S) {
      if (saved.S.profiles?.length) S.profiles = saved.S.profiles
      S.activeId = saved.S.activeId || S.profiles[0]?.id
      S.modelPinned = !!saved.S.modelPinned
      Object.assign(PILL_STATE, saved.S.parameters || {})
      darkMode = !!saved.S.darkMode
      document.documentElement.classList.toggle('dark', darkMode)
      document.body.classList.toggle('dark', darkMode)
      syncThemeIcon()
    }
    if (saved.G) Object.assign(G, generalSettingsOf(saved.G))
    if (saved.model != null) currentModel = saved.model
    if (saved.size != null) currentSize = saved.size
    renderList(); syncTitle(); renderChatView(); syncComposerModels(); refreshSizePill()
  } catch (error) { reportPersistenceError(error) }
}
window.addEventListener('bychat:storage', scheduleStorageRefresh)
window.addEventListener('focus', scheduleStorageRefresh)

async function restoreState() {
  if (!window.ByChatDB) return
  try {
    const saved = await window.ByChatDB.getSetting('S', null)
    if (saved) {
      if (Array.isArray(saved.profiles) && saved.profiles.length) {
        S.profiles = saved.profiles
        S.activeId = saved.activeId || S.profiles[0].id
      }
      S.modelPinned = !!saved.modelPinned
      if (saved.parameters && typeof saved.parameters === 'object') {
        for (const key of Object.keys(PILL_STATE)) {
          if (typeof saved.parameters[key] === 'string') PILL_STATE[key] = saved.parameters[key]
        }
      }
      darkMode = !!saved.darkMode
      document.documentElement.classList.toggle('dark', darkMode)
      document.body.classList.toggle('dark', darkMode)
      syncThemeIcon()
      const themeButton = document.getElementById('themeToggleBtn')
      if (themeButton) themeButton.title = darkMode ? tr("切换到浅色模式") : tr("切换到深色模式")
    }

    const g = await window.ByChatDB.getSetting('G', null)
    if (g) Object.assign(G, generalSettingsOf(g))

    const m = await window.ByChatDB.getSetting('model', '')
    if (m) currentModel = m
    const sz = await window.ByChatDB.getSetting('size', '')
    if (sz) currentSize = sz
    window.ByChatSettingsReady = true

    const savedConvs = await window.ByChatDB.listConversations()
    conversations = restoreExampleConversations(savedConvs, window.ByChatDB.deletedExampleIds?.() || [])
    const lastActiveId = await window.ByChatDB.getSetting('activeConversationId', null)
    activeId = conversations.find((c) => c.id === lastActiveId)?.id
      ?? conversations.find((c) => c.active)?.id
      ?? conversations[0]?.id ?? null
    conversations.forEach((c) => (c.active = c.id === activeId))
    nextId = Math.max(nextId, ...conversations.map((c) => Number(c.id) + 1).filter(Number.isFinite))

    const savedGroups = await ByChatDB.getSetting('groups', null)
    groupDefs = [
      ...DEFAULT_GROUPS.map((group) => ({ ...group, ...(Array.isArray(savedGroups) ? savedGroups.find((item) => item.key === group.key) : {}) })),
      ...(Array.isArray(savedGroups) ? savedGroups.filter((group) => !DEFAULT_GROUPS.some((item) => item.key === group.key)) : []),
    ]
    groupSeq = Math.max(0, ...groupDefs.map((group) => /^g\d+$/.test(group.key) ? Number(group.key.slice(1)) : 0))
    if (G.persistInputOnRestart) {
      const draft = await ByChatDB.getSetting('composerDraft', null)
      if (draft && typeof draft.prompt === 'string') {
        promptInput.value = draft.prompt
        inputImages = Array.isArray(draft.images) ? draft.images.slice(0, MAX_INPUT_IMAGES) : []
        renderInputImages()
      }
    } else {
      await ByChatDB.getSetting('composerDraft', null)
      await ByChatDB.deleteSetting('composerDraft')
    }
    // 为旧版缓存补齐模型档位，无需用户再次填写密钥。
    window.__ByChatDraftSnapshot = JSON.stringify({ prompt: promptInput.value, images: [...inputImages] })
    if (window.ByChatAPI?.withModelCapabilities) {
      for (const p of S.profiles) p.models = await ByChatAPI.withModelCapabilities(p.models || [])
    }

    renderList()
    syncTitle()
    stickBottom()
    renderChatView()
    syncComposerModels()
    refreshSizePill()
    window.ByChatStorageReady = true
    await persistConversations(true)
    if (typeof persistSettings === 'function') await persistSettings(true)

    // 没有 Key 就引导用户去填（服务端不保存 Key，只能本机填）
    const p = activeProfile()
    if (!p || !p.key || !p.key.trim()) openSettings()
  } catch (err) {
    console.warn('恢复本机数据失败：', err)
    if (typeof showToast === 'function') showToast(tr("恢复本机数据失败，请检查浏览器的站点存储权限"), 'error')
  }
}

/**
 * 页面一加载就探一下后端。连不上时直接在页面上挂一条横幅，
 * 把「当前页面地址」和「后端该在哪个端口」写清楚 ——
 * 以前只有一句「连不上本地服务」，用户根本分不清是后端没起还是端口填错了。
 */
async function probeBackend() {
  const bar = document.getElementById('backendDownBar')
  try {
    const resp = await fetch('/api/healthz', { cache: 'no-store' })
    if (resp.ok) {
      // 后端活过来了，把之前挂的横幅撤掉
      if (bar) { bar.remove(); document.body.style.paddingTop = '' }
      return true
    }
    throw new Error(`HTTP ${resp.status}`)
  } catch (err) {
    if (bar) return false // 已经在提示了，别重复挂
    const el = document.createElement('div')
    el.id = 'backendDownBar'
    el.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:9999',
      'padding:10px 16px', 'background:#b42318', 'color:#fff',
      'font-size:13px', 'line-height:1.7', 'white-space:pre-wrap',
    ].join(';')
    // 为什么连不上，只有两种常见原因，都给出来，别让用户自己猜：
    //   1) localhost 被解析成 IPv6 的 ::1，而服务端只听了 IPv4
    //      —— Chrome 会回退所以没事，Firefox / Edge 有些配置下直接失败
    //   2) 浏览器走了系统代理，代理够不着 localhost
    //      —— 这是「Chrome 能开、Edge/Firefox 不能」最常见的原因
    //         （Chrome 多半装了代理扩展并绕过了 localhost，Edge 没有）
    const port = location.port || ''
    el.textContent =
      tr("⚠️ 连不上后端：{0} 没有响应（{1}）\n", location.origin, err.message)
      + tr("当前页面端口是 {0}。确认后端在跑：sudo systemctl status bychat-backend\n", port || tr("(未指定端口)"))
      + tr('① 试试直接用 IP 打开本页（localhost 可能被解析成了 IPv6，而后端只听 IPv4）\n')
      + tr('② 如果只有 Chrome 能开：多半是系统代理拦了 localhost —— ')
      + tr('Windows 设置 → 网络和 Internet → 代理 → 关掉「使用代理服务器」，')
      + tr('或在「不使用代理服务器的地址」里加 localhost;127.0.0.1')
    if (location.hostname === 'localhost') {
      const a = document.createElement('a')
      a.href = `http://127.0.0.1:${port}/`
      a.textContent = `http://127.0.0.1:${port}/`
      a.style.cssText = 'color:#fff;text-decoration:underline;font-weight:600'
      el.appendChild(document.createTextNode('\n   → '))
      el.appendChild(a)
    }
    document.body.appendChild(el)
    document.body.style.paddingTop = '84px'
    return false
  }
}

/* ---------- 链路选择：直连上游 还是 经后端中转 ---------- */

/**
 * 默认是自动探测：先试直连，被同源策略拦下就自动改走中转并记住。
 * 想强制指定就加查询参数访问一次（前端要照抄原型、不能自创 UI，所以用隐藏开关）：
 *   ?transport=direct   强制直连上游
 *   ?transport=proxy    强制经后端中转
 *   ?transport=auto     改回自动
 */
function applyTransportOverride() {
  if (!window.ByChatAPI) return
  const qs = new URLSearchParams(location.search).get('transport')
  if (qs) {
    if (qs === 'auto') localStorage.removeItem('bychat.transport')
    else localStorage.setItem('bychat.transport', qs)
  }
  ByChatAPI.setTransportOverride(localStorage.getItem('bychat.transport') || '')
}

/* module 在 DOMContentLoaded 前完成，不必等待示例图片和字体加载完再恢复对话。 */
window.addEventListener('DOMContentLoaded', applyTransportOverride)
window.addEventListener('DOMContentLoaded', () => {
  window.ByChatReady = restoreState()
})
window.addEventListener('DOMContentLoaded', probeBackend)
