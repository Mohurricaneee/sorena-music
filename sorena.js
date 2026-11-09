/* ============================================
   SORENA MUSIC - JAVASCRIPT V3
   - Working nav menu
   - Full search (songs, albums, playlists, ARTISTS)
   - Artist pages with all songs (Cassett artist API)
   - All media through local proxy
   ============================================ */

const API_SECTIONS = '/api/v3/sections/new';
const API_SEARCH = (q) => `/api/v3/search?q=${encodeURIComponent(q)}`;
const API_ALBUM = (id) => `/api/v3/album/${encodeURIComponent(id)}`;
const API_PLAYLIST = (id) => `/api/v3/playlist-cassett?id=${encodeURIComponent(id)}&all=true`;
const API_SPOT_PLAYLIST = (uri) => `/api/v3/playlist/${encodeURIComponent(uri)}`;
const API_ARTIST = (uri) => `/api/v3/artist/${encodeURIComponent(uri)}`;
const API_CATEGORIES = '/api/spot/search/item';
const API_GENRE = (json) => `/api/spot/genre/web/${encodeURIComponent(JSON.stringify(json))}`;

// State
let allSections = [];
let currentHeroIndex = 0;
let heroTimer = null;
let modalTracks = [];
let isSearchMode = false;
const playableTracks = new Map(); // id -> track object (for playById)

// Helpers
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const audio = $('#audio');
const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Crect fill=%27%23222%27 width=%27100%27 height=%27100%27/%3E%3C/svg%3E';

// Route cassett media through local proxy (avoids referer/hotlink issues)
function proxify(u) {
  if (!u) return '';
  try {
    const url = new URL(u, 'https://www.cassett.app');
    const h = url.hostname;
    // Cassett media -> local relative path
    if (h === 'www.cassett.app' || h === 'cassett.app' || h === 'host.cassett.app') {
      return url.pathname + url.search;
    }
    // Spotify artwork CDNs -> local image proxy
    if (['i.scdn.co', 'pickasso.spotifycdn.com', 'pl.scdn.co', 'mosaic.scdn.co', 'seed-mix-image.spotifycdn.com', 'dailymix-images.scdn.co'].includes(h)) {
      return '/img?u=' + encodeURIComponent(u);
    }
    return u;
  } catch { return u; }
}

function bareId(id) {
  return String(id || '').replace(/^spotify:(album|playlistCassett|artist|playlist):/, '');
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDur(ms) {
  if (!ms || !Number.isFinite(ms)) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatTime(s) {
  if (!s || !Number.isFinite(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function registerTrack(t) {
  const url = proxify(t.playUrl || t.streamLink || t.downloadLink);
  const id = String(t.originalId || t.id || '');
  if (!url || !id) return null;
  const obj = {
    id,
    url,
    title: t.nameFa || t.name || t.trackName || 'بدون عنوان',
    artist: t.artistNamesFa || t.artistNames || '',
    img: proxify(t.imageUrl || t.images || t.image) || PLACEHOLDER,
    dl: proxify(t.downloadLink) || '',
  };
  playableTracks.set(id, obj);
  return obj;
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initPlayerControls();
  initSearch();
  initNav();
  loadData();
});

function initNav() {
  $$('.nav-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      scrollToSection(a.dataset.section);
    });
  });
}

function scrollToSection(sectionId) {
  if (isSearchMode) {
    exitSearchMode();
    setTimeout(() => doScroll(sectionId), 150);
  } else {
    doScroll(sectionId);
  }
}

function doScroll(sectionId) {
  const section = $(`#section-${sectionId}`);
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $$('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.section === sectionId));
  }
}

// ============================================
// LOAD HOME
// ============================================
async function loadData() {
  showLoading(true);
  try {
    const res = await fetch(API_SECTIONS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allSections = data.sections || [];
    renderAll();
    showLoading(false);
  } catch (e) {
    console.error('Load error:', e);
    showError(e.message);
  }
}

function showLoading(show) {
  $('#loading').style.display = show ? 'flex' : 'none';
  $('#content').style.display = show ? 'none' : 'block';
  $('#errorState').style.display = 'none';
}

function showError(msg) {
  $('#loading').style.display = 'none';
  $('#content').style.display = 'none';
  $('#errorState').style.display = 'flex';
  $('#errorMessage').textContent = msg;
}

// ============================================
// RENDER HOME
// ============================================
function renderAll() {
  renderCategories();
  renderHero();
  renderBanners();
  renderSections();
  initCarouselNavs();
}

// ============================================
// CATEGORIES (like Cassett search page)
// ============================================
let categoryCache = null;

async function renderCategories() {
  const chipsEl = $('#categoryChips');
  const section = $('#section-categories');
  if (!chipsEl) return;

  try {
    let data = categoryCache;
    if (!data) {
      const res = await fetch(API_CATEGORIES);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
      categoryCache = data;
    }

    const items = (data.content?.items || []).filter(i => i.href && i.href.startsWith('/views/') && i.name && !i.name.includes('xlink'));
    if (!items.length) { section.style.display = 'none'; return; }

    section.style.display = '';
    chipsEl.innerHTML = items.slice(0, 24).map(c => {
      const id = c.href.split('/views/')[1];
      return `
        <button class="category-chip" onclick="openCategory('${esc(id)}','${esc(c.nameFa || c.name)}')">
          <span class="chip-dot" style="background:${esc(c.backgroundColor || '#888')}"></span>
          ${esc(c.nameFa || c.name)}
        </button>`;
    }).join('');
  } catch (e) {
    console.warn('Categories failed to load:', e.message);
    section.style.display = 'none';
  }
}

async function openCategory(id, label) {
  const grid = $('#categoryView');
  grid.style.display = 'block';
  grid.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>در حال بارگذاری ' + esc(label) + '…</p></div>';
  document.querySelectorAll('#section-categories, #section-hero, #section-banners').forEach(s => s.style.display = 'none');
  $('#sectionsContainer').style.display = 'none';

  try {
    const payload = { pagePagination: { offset: 0, limit: 10 }, sectionPagination: { offset: 0, limit: 10 }, uri: 'spotify:page:' + id };
    const res = await fetch(API_GENRE(payload));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const browse = data.results?.data?.browse || {};
    const sections = browse.sections?.items || [];
    let playlists = [];

    // Gather all spotify playlist URIs from the browse sections
    for (const s of sections) {
      for (const it of (s.sectionItems?.items || [])) {
        const uri = it.uri || it.content?.uri || '';
        if (uri.startsWith('spotify:playlist:')) playlists.push(uri);
      }
    }

    // Also gather album URIs
    let albums = [];
    for (const s of sections) {
      for (const it of (s.sectionItems?.items || [])) {
        const uri = it.uri || it.content?.uri || '';
        if (uri.startsWith('spotify:album:')) albums.push(uri);
      }
    }

    // Build header + sections listing (each playlist shown as a playable card that opens its tracks)
    let html = `<div class="cat-header"><button class="cat-back" onclick="closeCategory()">← بازگشت</button><h2>${esc(label)}</h2></div>`;

    if (sections.length) {
      html += sections.map(s => {
        const title = s.data?.title?.transformedLabel || '';
        const its = s.sectionItems?.items || [];
        const cards = its.map(it => {
          const uri = it.uri || it.content?.uri || '';
          const name = it.content?.name || '';
          const img = proxify(it.content?.images?.items?.[0]?.sources?.[0]?.url) || '';
          const kind = uri.includes(':album:') ? 'album' : 'playlist';
          if (!uri) return '';
          const ja = it.content?.attributes || [];
          const bg = (Array.isArray(ja) && ja.find) ? (ja.find(a => a.key === 'primary_color')?.value || '') : '';
          return `
            <div class="card card-sm" data-uri="${esc(uri)}" data-kind="${kind}" onclick="openByUri('${esc(uri)}','${esc(name)}','${esc(kind)}')">
              <div class="card-cover">
                <img src="${esc(img || PLACEHOLDER)}" alt="${esc(name)}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
                <div class="card-shade"></div>
              </div>
              <div class="card-info">
                <div class="card-title text-ellipsis">${esc(name)}</div>
              </div>
            </div>`;
        }).filter(Boolean).join('');
        return cards ? `<div class="section"><div class="section-header"><h2 class="section-title">${esc(title)}</h2></div><div class="carousel-wrapper"><div class="carousel">${cards}</div></div></div>` : '';
      }).join('');
    }

    if (!html.includes('card-cover')) {
      html += '<p style="text-align:center;color:var(--text-muted);padding:40px">محتوایی یافت نشد</p>';
    }

    grid.innerHTML = html;
    initCarouselNavs();
  } catch (e) {
    console.error('Category error:', e);
    grid.innerHTML = `<div class="cat-header"><button class="cat-back" onclick="closeCategory()">← بازگشت</button></div><p style="text-align:center;color:var(--error);padding:40px">خطا در بارگذاری دسته: ${esc(e.message)}</p>`;
  }
}

// Open a spotify playlist/album (from category) — converts to Cassett playable tracks
async function openByUri(uri, label, kind) {
  if (kind === 'album') {
    openCollection('album', uri.replace('spotify:album:', ''));
  } else {
    openCollection('playlist', uri); // full spotify URI → uses /api/v3/playlist
  }
}

function closeCategory() {
  const grid = $('#categoryView');
  grid.style.display = 'none';
  grid.innerHTML = '';
  document.querySelectorAll('#section-categories, #section-hero, #section-banners').forEach(s => s.style.display = '');
  $('#sectionsContainer').style.display = '';
}

function uniqueItems(items) {
  const seen = new Set();
  return (items || []).filter(v => {
    const key = v.id || v.originalId;
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
}

function kindLabel(kind) {
  if (kind === 'playlistCassett') return 'پلی‌لیست';
  if (kind === 'album') return 'آلبوم';
  if (kind === 'podcast') return 'پادکست';
  if (kind === 'artist') return 'هنرمند';
  return 'موزیک';
}

function renderHero() {
  const heroSec = allSections.find(s => s.presentation?.styleKey === 'featured_wide' && s.items?.length);
  const container = $('#section-hero');
  if (!heroSec) { container.innerHTML = ''; return; }

  const items = uniqueItems(heroSec.items);
  if (!items.length) { container.innerHTML = ''; return; }

  const slides = items.map((item, i) => {
    const title = item.nameFa || item.name || '';
    const sub = item.artistNamesFa || item.artistNames || item.description || '';
    const img = proxify(item.imageUrl || item.images || item.image);
    const kind = item.kind || '';
    const id = item.originalId || item.id || '';
    return `
      <div class="hero-slide" data-index="${i}">
        <img class="hero-image" src="${esc(img)}" alt="" onerror="this.style.display='none'">
        <div class="hero-content">
          <span class="hero-badge">${kindLabel(kind)}</span>
          <h2 class="hero-title">${esc(title)}</h2>
          <p class="hero-subtitle">${esc(sub)}</p>
          <button class="hero-btn" onclick="openByKind('${kind}','${esc(id)}',${i})">▶ پخش</button>
        </div>
      </div>`;
  }).join('');

  const dots = items.map((_, i) => `<div class="hero-dot ${i === 0 ? 'active' : ''}" data-i="${i}"></div>`).join('');

  container.innerHTML = `
    <div class="hero-slider">
      <div class="hero-track" id="heroTrack">${slides}</div>
      <div class="hero-dots">${dots}</div>
    </div>`;

  $$('.hero-dot').forEach(dot => {
    dot.addEventListener('click', () => { goToHero(+dot.dataset.i); resetHeroTimer(); });
  });
  currentHeroIndex = 0;
  resetHeroTimer();
}

function goToHero(i) {
  const track = $('#heroTrack');
  if (!track || !track.children.length) return;
  const count = track.children.length;
  if (i < 0) i = count - 1;
  if (i >= count) i = 0;
  currentHeroIndex = i;
  track.style.transform = `translateX(${i * 100}%)`;
  $$('.hero-dot').forEach((d, x) => d.classList.toggle('active', x === i));
}

function resetHeroTimer() {
  if (heroTimer) clearInterval(heroTimer);
  const track = $('#heroTrack');
  if (track && track.children.length > 1) {
    heroTimer = setInterval(() => goToHero(currentHeroIndex + 1), 6000);
  }
}

function openByKind(kind, id, heroIndex) {
  if (kind === 'track' || kind === 'podcast') {
    const heroSec = allSections.find(s => s.presentation?.styleKey === 'featured_wide');
    const item = heroSec && uniqueItems(heroSec.items)[heroIndex];
    if (item) playTrack(item);
  } else if (kind === 'album' || kind === 'playlistCassett') {
    openCollection(kind, id);
  } else if (kind === 'artist') {
    openArtist(id);
  }
}

function renderBanners() {
  const bannerSec = allSections.find(s => s.presentation?.styleKey === 'banner_carousel');
  const container = $('#section-banners');
  if (!bannerSec || !bannerSec.items?.length) { container.innerHTML = ''; return; }

  const banners = bannerSec.items.filter(b => b.enabled && b.imageUrl);
  if (!banners.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="banner-carousel">
      ${banners.map(b => `<a class="banner-card"><img src="${esc(proxify(b.imageUrl))}" alt="${esc(b.title)}" loading="lazy"></a>`).join('')}
    </div>`;
}

function renderSections() {
  const container = $('#sectionsContainer');
  const html = allSections
    .filter(s => s.presentation?.styleKey !== 'featured_wide' && s.presentation?.styleKey !== 'banner_carousel' && s.items?.length)
    .map(section => {
      const title = section.titleFa || section.title || '';
      const count = section.items.length;
      const style = section.presentation?.styleKey || 'default';
      const sectionId = getSectionId(section);
      const sizeClass = style === 'shelf_square' ? 'card-sm' : 'card';
      const cards = section.items.map(item => renderCard(item, sizeClass)).join('');
      return `
        <section class="section" id="section-${sectionId}">
          <div class="section-header"><h2 class="section-title">${esc(title)} <span class="section-count">${count}</span></h2></div>
          <div class="carousel-wrapper"><div class="carousel">${cards}</div></div>
        </section>`;
    }).join('');
  container.innerHTML = html;
}

function renderCard(item, sizeClass = '') {
  const title = item.nameFa || item.name || item.trackName || '';
  const sub = item.artistNamesFa || item.artistNames || item.description || '';
  const img = proxify(item.imageUrl || item.images || item.image);
  const kind = item.kind || item.type || '';
  const id = item.originalId || item.id || '';
  const playable = kind === 'track' || kind === 'podcast' || item.playUrl;

  if (playable) registerTrack(item);

  return `
    <div class="card ${sizeClass}" data-kind="${kind}" data-id="${esc(id)}" onclick="onCardClick(this)">
      <div class="card-cover">
        <img src="${esc(img || PLACEHOLDER)}" alt="${esc(title)}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
        <div class="card-shade"></div>
        ${playable ? `<button class="card-play" onclick="event.stopPropagation(); playById('${esc(id)}')">▶</button>` : ''}
      </div>
      <div class="card-info">
        <div class="card-title text-ellipsis">${esc(title)}</div>
        <div class="card-subtitle text-ellipsis">${esc(sub)}</div>
      </div>
    </div>`;
}

function getSectionId(s) {
  const t = (s.title || '').toLowerCase();
  if (t.includes('album') || t.includes('آلبوم')) return 'albums';
  if (t.includes('playlist') || t.includes('پلی') || t.includes('لیست')) return 'playlists';
  if (t.includes('dj') || t.includes('podcast') || t.includes('میکس') || t.includes('پادکست')) return 'dj';
  if (t.includes('song') || t.includes('آهنگ') || t.includes('new')) return 'new';
  return s.id?.slice(0, 8) || 'default';
}

function initCarouselNavs() {
  $$('.carousel-wrapper').forEach(wrapper => {
    const carousel = wrapper.querySelector('.carousel');
    if (!carousel) return;
    wrapper.querySelectorAll('.carousel-nav').forEach(n => n.remove());

    const prevBtn = document.createElement('button');
    prevBtn.className = 'carousel-nav prev';
    prevBtn.innerHTML = '→';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'carousel-nav next';
    nextBtn.innerHTML = '←';
    wrapper.appendChild(prevBtn);
    wrapper.appendChild(nextBtn);

    const updateNav = () => {
      const max = carousel.scrollWidth - carousel.clientWidth;
      prevBtn.classList.toggle('disabled', carousel.scrollLeft <= 0);
      nextBtn.classList.toggle('disabled', carousel.scrollLeft >= max - 5);
    };
    prevBtn.onclick = () => carousel.scrollBy({ left: -280, behavior: 'smooth' });
    nextBtn.onclick = () => carousel.scrollBy({ left: 280, behavior: 'smooth' });
    carousel.addEventListener('scroll', updateNav);
    updateNav();
  });
}

// ============================================
// CARD CLICK
// ============================================
function onCardClick(card) {
  const kind = card.dataset.kind;
  const id = card.dataset.id;
  if (kind === 'track' || kind === 'podcast') playById(id);
  else if (kind === 'artist') openArtist(id);
  else if (kind === 'album' || kind === 'playlistCassett' || kind === 'playlist') openCollection(kind, id);
}

// ============================================
// PLAYER
// ============================================
function playById(trackId) {
  const t = playableTracks.get(String(trackId));
  if (t) playTrack(t);
}

function playTrack(t) {
  const obj = (t.url !== undefined && t.title !== undefined) ? t : registerTrack(t);
  if (!obj || !obj.url) return;

  $('#playerCover').src = obj.img;
  $('#playerTitle').textContent = obj.title;
  $('#playerArtist').textContent = obj.artist;

  const dlBtn = $('#downloadBtn');
  if (obj.dl) {
    dlBtn.href = obj.dl;
    dlBtn.download = `${obj.title} - ${obj.artist}`.replace(/[\\/:*?"<>|]/g, '_');
    dlBtn.style.display = 'flex';
  } else {
    dlBtn.style.display = 'none';
  }

  audio.src = obj.url;
  audio.play().then(() => { $('#playBtn').textContent = '⏸'; })
    .catch(() => { $('#playBtn').textContent = '▶'; });
}

function initPlayerControls() {
  const playBtn = $('#playBtn');
  playBtn.onclick = () => {
    if (!audio.src) return;
    if (audio.paused) { audio.play(); playBtn.textContent = '⏸'; }
    else { audio.pause(); playBtn.textContent = '▶'; }
  };
  $('#prevBtn').onclick = () => { audio.currentTime = Math.max(0, audio.currentTime - 10); };
  $('#nextBtn').onclick = () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); };

  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    $('#progressFill').style.width = (audio.currentTime / audio.duration) * 100 + '%';
    $('#currentTime').textContent = formatTime(audio.currentTime);
  };
  audio.onloadedmetadata = () => { $('#totalTime').textContent = formatTime(audio.duration); };
  audio.onplay = () => playBtn.textContent = '⏸';
  audio.onpause = () => playBtn.textContent = '▶';
  audio.onended = () => playBtn.textContent = '▶';

  $('#progressBar').onclick = (e) => {
    if (!audio.duration) return;
    const rect = $('#progressBar').getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
  };
  $('#volumeSlider').oninput = (e) => audio.volume = e.target.value;
  audio.volume = 0.7;

  document.onkeydown = (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
  };
}

// ============================================
// COLLECTION MODAL (Album / Playlist)
// ============================================
async function openCollection(kind, rawId) {
  const id = bareId(rawId);
  const modal = $('#collectionModal');
  const header = $('#modalHeader');
  const body = $('#modalBody');

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  header.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  body.innerHTML = '';

  try {
    let apiUrl;
    if (kind === 'playlistCassett' || kind === 'playlist') {
      // If full spotify URI (from categories), use spot playlist endpoint
      const raw = String(rawId);
      if (raw.startsWith('spotify:playlist:')) {
        apiUrl = API_SPOT_PLAYLIST(raw);
      } else {
        apiUrl = API_PLAYLIST('spotify:playlistCassett:' + id);
      }
    } else {
      apiUrl = API_ALBUM('spotify:album:' + id);
    }

    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const name = data.name || data.nameFa || 'مجموعه';
    const img = proxify(data.images || data.imageUrl || data.image);
    const desc = data.description || '';
    const rawTracks = data.tracks || [];
    const totalMs = rawTracks.reduce((s, t) => s + (t.durationMs || t.trackDuration || 0), 0);

    modalTracks = rawTracks.map(registerTrack).filter(Boolean);

    header.innerHTML = `
      <div class="modal-header-inner">
        <div class="modal-cover"><img src="${esc(img || PLACEHOLDER)}" alt="" onerror="this.src='${PLACEHOLDER}'"></div>
        <div class="modal-info">
          <div class="modal-type">${kind === 'playlistCassett' || kind === 'playlist' ? 'پلی‌لیست' : 'آلبوم'}</div>
          <h2 class="modal-title">${esc(name)}</h2>
          ${desc ? `<p class="modal-subtitle">${esc(desc)}</p>` : ''}
          <div class="modal-meta"><span>${modalTracks.length} آهنگ</span>${totalMs ? `<span>${formatDur(totalMs)}</span>` : ''}</div>
          <div class="modal-actions"><button class="modal-play-btn" onclick="playAllModal()">▶ پخش همه</button></div>
        </div>
      </div>`;

    body.innerHTML = modalTracks.length
      ? `<div class="track-list">${modalTracks.map((t, i) => trackRow(t, i)).join('')}</div>`
      : '<p style="text-align:center;color:var(--text-muted);padding:40px">آهنگی یافت نشد</p>';
  } catch (err) {
    console.error('Collection error:', err);
    header.innerHTML = `<p style="color:#ef4444;text-align:center;padding:40px">خطا در بارگذاری: ${esc(err.message)}</p>`;
  }
}

function trackRow(t, i) {
  return `
    <div class="track-item" data-i="${i}">
      <span class="track-num">${i + 1}</span>
      <div class="track-cover"><img src="${esc(t.img)}" alt="" onerror="this.src='${PLACEHOLDER}'"></div>
      <div class="track-info">
        <div class="track-name">${esc(t.title)}</div>
        <div class="track-artist">${esc(t.artist)}</div>
      </div>
      ${t.durationMs ? `<span class="track-dur">${formatDur(t.durationMs)}</span>` : ''}
      <div class="track-btns">
        <button class="track-btn" onclick="playModalTrack(${i})" title="پخش">▶</button>
        ${t.dl ? `<a class="track-btn" href="${esc(t.dl)}" download title="دانلود">⬇</a>` : ''}
      </div>
    </div>`;
}

function playModalTrack(i) {
  const t = modalTracks[i];
  if (t) playTrack(t);
  $$('.modal .track-item').forEach((item, x) => item.classList.toggle('playing', x === i));
}

function playAllModal() {
  const first = modalTracks.find(t => t.url);
  if (first) { playTrack(first); $$('.modal .track-item')[0]?.classList.add('playing'); }
}

function closeCollection() {
  $('#collectionModal').classList.remove('active');
  document.body.style.overflow = '';
  modalTracks = [];
}

// ============================================
// ARTIST PAGE
// ============================================
async function openArtist(rawId) {
  const uri = String(rawId).startsWith('spotify:artist:') ? rawId : 'spotify:artist:' + bareId(rawId);
  const modal = $('#collectionModal');
  const header = $('#modalHeader');
  const body = $('#modalBody');

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  header.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';
  body.innerHTML = '';

  try {
    const res = await fetch(API_ARTIST(uri));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const a = data.artistUnion || {};

    const name = a.profile?.nameFa || a.profile?.name || 'هنرمند';
    const avatar = proxify(a.visuals?.avatarImage?.sources?.[0]?.url);
    const headerImg = proxify(a.visuals?.headerImage?.sources?.[0]?.url);
    const listeners = a.stats?.monthlyListeners ? Number(a.stats.monthlyListeners).toLocaleString('fa-IR') : '';
    const followers = a.stats?.followers ? Number(a.stats.followers).toLocaleString('fa-IR') : '';

    const topTracks = (a.discography?.topTracks || []).map(registerTrack).filter(Boolean);
    const albums = (a.discography?.albums?.items || a.discography?.releases?.items || a.discography?.popularReleasesAlbums?.items || [])
      .map(al => {
        const uri2 = al.uri || '';
        return {
          id: uri2.replace('spotify:album:', ''),
          name: al.name,
          img: proxify(al.coverArt?.sources?.[0]?.url || al.images),
          year: al.date?.year || '',
        };
      }).filter(al => al.id);
    const related = (data.relatedContent?.relatedArtists?.items || []).map(ra => ({
      id: (ra.uri || '').replace('spotify:artist:', ''),
      name: ra.profile?.nameFa || ra.profile?.name || '',
      img: proxify(ra.visuals?.avatarImage?.sources?.[0]?.url),
    })).filter(r => r.id);

    header.innerHTML = `
      <div class="artist-header" ${headerImg ? `style="background-image:url('${esc(headerImg)}')"` : ''}>
        <div class="artist-header-inner">
          <div class="artist-avatar"><img src="${esc(avatar || PLACEHOLDER)}" alt="" onerror="this.src='${PLACEHOLDER}'"></div>
          <div class="artist-info">
            <div class="modal-type">هنرمند</div>
            <h2 class="modal-title">${esc(name)}</h2>
            <div class="modal-meta">
              ${listeners ? `<span>${listeners} شنونده ماهانه</span>` : ''}
              ${followers ? `<span>${followers} دنبال‌کننده</span>` : ''}
            </div>
            <div class="modal-actions"><button class="modal-play-btn" onclick="playAllModal()">▶ پخش محبوب‌ترین‌ها</button></div>
          </div>
        </div>
      </div>`;

    modalTracks = topTracks;

    let bodyHtml = '';
    if (topTracks.length) {
      bodyHtml += `<h3 class="modal-section-title">محبوب‌ترین آهنگ‌ها</h3><div class="track-list">${topTracks.map((t, i) => trackRow(t, i)).join('')}</div>`;
    }
    if (albums.length) {
      bodyHtml += `<h3 class="modal-section-title">آلبوم‌ها</h3><div class="carousel-wrapper"><div class="carousel">
        ${albums.map(al => `
          <div class="card card-sm" onclick="openCollection('album','${esc(al.id)}')">
            <div class="card-cover"><img src="${esc(al.img || PLACEHOLDER)}" alt="${esc(al.name)}" loading="lazy" onerror="this.src='${PLACEHOLDER}'"></div>
            <div class="card-info"><div class="card-title text-ellipsis">${esc(al.name)}</div><div class="card-subtitle">${esc(al.year)}</div></div>
          </div>`).join('')}
      </div></div>`;
    }
    if (related.length) {
      bodyHtml += `<h3 class="modal-section-title">هنرمندان مشابه</h3><div class="carousel-wrapper"><div class="carousel">
        ${related.map(r => `
          <div class="card card-round" onclick="openArtist('spotify:artist:${esc(r.id)}')">
            <div class="card-cover"><img src="${esc(r.img || PLACEHOLDER)}" alt="${esc(r.name)}" loading="lazy" onerror="this.src='${PLACEHOLDER}'"></div>
            <div class="card-info"><div class="card-title text-ellipsis">${esc(r.name)}</div></div>
          </div>`).join('')}
      </div></div>`;
    }

    body.innerHTML = bodyHtml || '<p style="text-align:center;color:var(--text-muted);padding:40px">اطلاعاتی یافت نشد</p>';
    initCarouselNavs();
  } catch (err) {
    console.error('Artist error:', err);
    header.innerHTML = `<p style="color:#ef4444;text-align:center;padding:40px">خطا در بارگذاری هنرمند: ${esc(err.message)}</p>`;
  }
}

// ============================================
// SEARCH (full Cassett search API)
// ============================================
let searchTimeout;

function initSearch() {
  const input = $('#searchInput');
  if (!input) return;
  input.oninput = () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (!q) { exitSearchMode(); return; }
    searchTimeout = setTimeout(() => performSearch(q), 400);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { clearTimeout(searchTimeout); const q = input.value.trim(); if (q) performSearch(q); }
  };
}

async function performSearch(q) {
  showLoading(true);
  try {
    const res = await fetch(API_SEARCH(q));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    isSearchMode = true;
    $('#section-hero').classList.add('hidden');
    $('#section-banners').classList.add('hidden');
    showLoading(false);
    renderSearchResults(data);
  } catch (e) {
    showLoading(false);
    showError(e.message);
  }
}

function renderSearchResults(data) {
  const container = $('#sectionsContainer');
  const results = data.results || [];

  const songs = results.filter(r => r.type === 'song' || r.kind === 'track');
  const artists = results.filter(r => r.type === 'artist' || r.kind === 'artist');
  const albums = results.filter(r => r.type === 'album' || r.kind === 'album');
  const playlists = results.filter(r => r.type === 'playlist' || r.kind === 'playlistCassett');

  if (!results.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted)">
        <div style="font-size:48px;margin-bottom:16px">🔍</div>
        <h3>نتیجه‌ای یافت نشد</h3><p style="margin-top:8px">عبارت دیگری جستجو کنید</p>
      </div>`;
    return;
  }

  let html = '';

  if (artists.length) {
    html += `
      <section class="section">
        <div class="section-header"><h2 class="section-title">هنرمندان <span class="section-count">${artists.length}</span></h2></div>
        <div class="carousel-wrapper"><div class="carousel">
          ${artists.slice(0, 12).map(a => {
            const id = a.originalId || a.id || '';
            const name = a.nameFa || a.name || '';
            const img = proxify(a.imageUrl || a.images || a.image);
            const listeners = a.monthlyListeners ? Number(a.monthlyListeners).toLocaleString('fa-IR') + ' شنونده' : '';
            return `
              <div class="card card-round" data-kind="artist" data-id="${esc(id)}" onclick="onCardClick(this)">
                <div class="card-cover"><img src="${esc(img || PLACEHOLDER)}" alt="${esc(name)}" loading="lazy" onerror="this.src='${PLACEHOLDER}'"></div>
                <div class="card-info"><div class="card-title text-ellipsis">${esc(name)}</div><div class="card-subtitle">${esc(listeners)}</div></div>
              </div>`;
          }).join('')}
        </div></div>
      </section>`;
  }

  if (songs.length) {
    songs.slice(0, 20).forEach(registerTrack);
    html += `
      <section class="section">
        <div class="section-header"><h2 class="section-title">آهنگ‌ها <span class="section-count">${songs.length}</span></h2></div>
        <div class="carousel-wrapper"><div class="carousel">
          ${songs.slice(0, 20).map(item => renderCard(item, 'card-sm')).join('')}
        </div></div>
      </section>`;
  }

  if (albums.length) {
    html += `
      <section class="section">
        <div class="section-header"><h2 class="section-title">آلبوم‌ها <span class="section-count">${albums.length}</span></h2></div>
        <div class="carousel-wrapper"><div class="carousel">
          ${albums.slice(0, 12).map(item => renderCard(item, 'card-sm')).join('')}
        </div></div>
      </section>`;
  }

  if (playlists.length) {
    html += `
      <section class="section">
        <div class="section-header"><h2 class="section-title">پلی‌لیست‌ها <span class="section-count">${playlists.length}</span></h2></div>
        <div class="carousel-wrapper"><div class="carousel">
          ${playlists.slice(0, 12).map(item => renderCard(item, 'card-sm')).join('')}
        </div></div>
      </section>`;
  }

  container.innerHTML = html;
  initCarouselNavs();
}

function exitSearchMode() {
  if (!isSearchMode) return;
  isSearchMode = false;
  $('#searchInput').value = '';
  $('#section-hero').classList.remove('hidden');
  $('#section-banners').classList.remove('hidden');
  renderAll();
}
