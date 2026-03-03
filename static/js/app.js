/* ═══════════════════════════════════════════════
   業務マニュアル管理 — Frontend Logic
   ═══════════════════════════════════════════════ */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  manuals:         [],
  categories:      [],
  currentManual:   null,
  filterCategory:  null,
  searchQuery:     '',
  editingId:       null,
  view:            'grid',
  ocrFile:         null,
  ocrText:         '',
  selectedColor:   '#3B82F6',
  searchTimer:     null,
};

const COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6',
  '#EF4444', '#EC4899', '#06B6D4', '#F97316',
  '#64748B', '#84CC16',
];

// ─── Marked Config ────────────────────────────────────────────────────────────

marked.setOptions({ breaks: true, gfm: true });

// ─── Initialise ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initColorSwatches();
  await Promise.all([loadCategories(), loadManuals()]);

  // Toolbar state: track cursor position in editor
  const ta = document.getElementById('editContent');
  ta.addEventListener('keyup',   updateToolbarState);
  ta.addEventListener('mouseup', updateToolbarState);
  ta.addEventListener('click',   updateToolbarState);
});

// ─── API Layer ────────────────────────────────────────────────────────────────

const api = {
  async request(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  getManuals(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/api/manuals${q ? '?' + q : ''}`);
  },
  getManual(id) { return this.request(`/api/manuals/${id}`); },
  createManual(data) { return this.request('/api/manuals', { method: 'POST', body: JSON.stringify(data) }); },
  updateManual(id, data) { return this.request(`/api/manuals/${id}`, { method: 'PUT', body: JSON.stringify(data) }); },
  deleteManual(id) { return this.request(`/api/manuals/${id}`, { method: 'DELETE' }); },
  getCategories() { return this.request('/api/categories'); },
  createCategory(data) { return this.request('/api/categories', { method: 'POST', body: JSON.stringify(data) }); },
  deleteCategory(id) { return this.request(`/api/categories/${id}`, { method: 'DELETE' }); },
  async ocr(file) {
    const fd = new FormData();
    fd.append('image', file);
    const res = await fetch('/api/ocr', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'OCRエラー');
    return data;
  },
};

// ─── Load & Render ────────────────────────────────────────────────────────────

async function loadCategories() {
  state.categories = await api.getCategories();
  renderCategories();
  renderCategorySelect();
}

async function loadManuals() {
  const params = {};
  if (state.searchQuery) params.search = state.searchQuery;
  if (state.filterCategory) params.category_id = state.filterCategory;
  state.manuals = await api.getManuals(params);
  renderManuals();
  updateBadgeCounts();
}

function renderCategories() {
  const list = document.getElementById('categoryList');
  list.innerHTML = state.categories.map(cat => `
    <div class="nav-item ${state.filterCategory === cat.id ? 'active' : ''}"
         onclick="filterCategory(${cat.id})">
      <span>${escapeHtml(cat.icon)} ${escapeHtml(cat.name)}</span>
      <div class="nav-item-right">
        <span class="badge">${cat.count}</span>
        <button class="btn-delete-cat" onclick="confirmDeleteCategory(event,${cat.id},'${escapeHtml(cat.name)}')" title="削除">✕</button>
      </div>
    </div>
  `).join('');
}

function updateBadgeCounts() {
  document.getElementById('badge-all').textContent = state.manuals.length;
}

function renderManuals() {
  const grid   = document.getElementById('manualGrid');
  const empty  = document.getElementById('emptyState');

  if (state.manuals.length === 0) {
    grid.style.display  = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  grid.style.display  = '';
  grid.className = state.view === 'grid' ? 'manual-grid' : 'manual-grid list-view';

  grid.innerHTML = state.manuals.map(m => {
    const catHtml = m.category
      ? `<div class="card-category"><span class="cat-badge" style="background:${m.category.color}20;color:${m.category.color}">${escapeHtml(m.category.icon)} ${escapeHtml(m.category.name)}</span></div>`
      : '';
    const tagsHtml = m.tags.length
      ? `<div class="card-tags">${m.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
    const excerpt = stripMarkdown(m.content).slice(0, 120);

    return `
      <div class="manual-card ${state.view === 'list' ? 'list-card' : ''}" onclick="openManual(${m.id})">
        ${catHtml}
        <h3 class="card-title">${escapeHtml(m.title)}</h3>
        <p class="card-excerpt">${escapeHtml(excerpt)}${excerpt.length < m.content.length ? '…' : ''}</p>
        ${tagsHtml}
        <small class="card-date">${formatDate(m.updated_at)}</small>
      </div>
    `;
  }).join('');
}

function renderCategorySelect() {
  const sel = document.getElementById('editCategory');
  const current = sel.value;
  sel.innerHTML = '<option value="">カテゴリなし</option>' +
    state.categories.map(c =>
      `<option value="${c.id}" ${current == c.id ? 'selected' : ''}>${escapeHtml(c.icon)} ${escapeHtml(c.name)}</option>`
    ).join('');
}

// ─── Filtering / Search ───────────────────────────────────────────────────────

function filterCategory(catId) {
  state.filterCategory = catId;

  // Update sidebar active state
  document.getElementById('nav-all').classList.toggle('active', catId === null);
  document.querySelectorAll('#categoryList .nav-item').forEach(el => el.classList.remove('active'));
  if (catId !== null) {
    const idx = state.categories.findIndex(c => c.id === catId);
    const items = document.querySelectorAll('#categoryList .nav-item');
    if (items[idx]) items[idx].classList.add('active');
  }

  // Update page title
  const cat = state.categories.find(c => c.id === catId);
  document.getElementById('pageTitle').textContent = cat ? `${cat.icon} ${cat.name}` : 'すべてのマニュアル';

  if (window.innerWidth <= 767) closeSidebar();
  loadManuals();
}

function debounceSearch(value) {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => {
    state.searchQuery = value.trim();
    loadManuals();
  }, 300);
}

function setView(v) {
  state.view = v;
  document.getElementById('btn-grid').classList.toggle('active', v === 'grid');
  document.getElementById('btn-list').classList.toggle('active', v === 'list');
  renderManuals();
}

// ─── Manual Detail ────────────────────────────────────────────────────────────

async function openManual(id) {
  try {
    state.currentManual = await api.getManual(id);
    renderDetail(state.currentManual);
    openModal('detailOverlay');
  } catch (e) {
    showToast('読み込みに失敗しました', 'error');
  }
}

function renderDetail(m) {
  const catBadge = document.getElementById('detail-cat-badge');
  if (m.category) {
    catBadge.textContent = `${m.category.icon} ${m.category.name}`;
    catBadge.style.background = `${m.category.color}20`;
    catBadge.style.color = m.category.color;
    catBadge.style.display = 'inline-flex';
  } else {
    catBadge.style.display = 'none';
  }

  document.getElementById('detail-title').textContent = m.title;

  const tagsEl = document.getElementById('detail-tags');
  tagsEl.innerHTML = m.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

  document.getElementById('detail-date').textContent =
    `作成: ${formatDate(m.created_at)} ／ 更新: ${formatDate(m.updated_at)}`;

  document.getElementById('detail-content').innerHTML =
    m.content ? marked.parse(m.content) : '<p style="color:#94A3B8">内容がありません</p>';
}

function editCurrentManual() {
  closeModal('detailOverlay');
  openEditModal(state.currentManual);
}

function deleteCurrentManual() {
  showConfirm(
    `「${state.currentManual.title}」を削除しますか？この操作は元に戻せません。`,
    async () => {
      try {
        await api.deleteManual(state.currentManual.id);
        closeModal('detailOverlay');
        showToast('削除しました', 'success');
        await loadManuals();
        await loadCategories();
      } catch (e) {
        showToast('削除に失敗しました', 'error');
      }
    }
  );
}

// ─── Create / Edit ────────────────────────────────────────────────────────────

function openCreateModal() {
  state.editingId = null;
  document.getElementById('editModalTitle').textContent = '新規マニュアル作成';
  document.getElementById('editTitle').value   = '';
  document.getElementById('editContent').value = '';
  document.getElementById('editTags').value    = '';
  document.getElementById('editCategory').value = '';
  setEditorMode('edit');
  clearOCR();
  openModal('editOverlay');
}

function openEditModal(m) {
  state.editingId = m.id;
  document.getElementById('editModalTitle').textContent = 'マニュアルを編集';
  document.getElementById('editTitle').value    = m.title;
  document.getElementById('editContent').value  = m.content;
  document.getElementById('editTags').value     = m.tags.join('　');
  document.getElementById('editCategory').value = m.category_id || '';
  setEditorMode('edit');
  clearOCR();
  openModal('editOverlay');
}

function setEditorMode(mode) {
  const textarea = document.getElementById('editContent');
  const preview  = document.getElementById('editPreview');
  const tabEdit  = document.getElementById('tab-edit');
  const tabPrev  = document.getElementById('tab-preview');
  const toolbar  = document.getElementById('formatToolbar');

  if (mode === 'preview') {
    preview.innerHTML = textarea.value ? marked.parse(textarea.value) : '<p style="color:#94A3B8">内容がありません</p>';
    textarea.style.display    = 'none';
    preview.style.display     = '';
    toolbar.style.opacity     = '0.4';
    toolbar.style.pointerEvents = 'none';
    tabEdit.classList.remove('active');
    tabPrev.classList.add('active');
  } else {
    textarea.style.display    = '';
    preview.style.display     = 'none';
    toolbar.style.opacity     = '';
    toolbar.style.pointerEvents = '';
    tabEdit.classList.add('active');
    tabPrev.classList.remove('active');
    textarea.focus();
  }
}

async function saveManual() {
  const title = document.getElementById('editTitle').value.trim();
  if (!title) {
    document.getElementById('editTitle').focus();
    showToast('タイトルを入力してください', 'error');
    return;
  }

  const rawTags = document.getElementById('editTags').value;
  const tags = rawTags.split(/[,、　\s]+/).map(t => t.trim()).filter(Boolean);

  const data = {
    title,
    content:     document.getElementById('editContent').value,
    category_id: document.getElementById('editCategory').value || null,
    tags,
  };

  try {
    if (state.editingId) {
      await api.updateManual(state.editingId, data);
      showToast('保存しました', 'success');
    } else {
      await api.createManual(data);
      showToast('作成しました', 'success');
    }
    closeModal('editOverlay');
    await loadManuals();
    await loadCategories();
  } catch (e) {
    showToast('保存に失敗しました', 'error');
  }
}

// ─── Format Toolbar ───────────────────────────────────────────────────────────

function applyBlockFormat(type) {
  const ta    = document.getElementById('editContent');
  const value = ta.value;
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;

  // Find boundaries of selected lines
  const lineStart  = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = value.indexOf('\n', end);
  const lineEnd    = lineEndIdx === -1 ? value.length : lineEndIdx;

  const lines = value.slice(lineStart, lineEnd).split('\n');
  const prefixMap = { h1: '# ', h2: '## ', h3: '### ', h4: '#### ', body: '' };

  const newLines = lines.map(line => {
    // Strip existing heading prefix and caption wrapper
    let stripped = line.replace(/^#{1,6} /, '');
    stripped = stripped.replace(/^<p class="caption">(.*?)<\/p>$/, '$1');

    if (type === 'caption') {
      return `<p class="caption">${stripped}</p>`;
    }
    return (prefixMap[type] ?? '') + stripped;
  });

  const newBlock = newLines.join('\n');
  ta.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  ta.setSelectionRange(lineStart, lineStart + newBlock.length);
  ta.focus();
  updateToolbarState();
}

function applyInlineFormat(type) {
  const ta       = document.getElementById('editContent');
  const start    = ta.selectionStart;
  const end      = ta.selectionEnd;
  const selected = ta.value.slice(start, end);

  const wrapMap = {
    bold:   ['**', '**'],
    italic: ['*', '*'],
    mark:   ['<mark>', '</mark>'],
  };
  const [open, close] = wrapMap[type];

  const replacement = open + selected + close;
  ta.value = ta.value.slice(0, start) + replacement + ta.value.slice(end);

  // Keep selection on the wrapped text, or position cursor between markers
  if (selected) {
    ta.setSelectionRange(start, start + replacement.length);
  } else {
    ta.setSelectionRange(start + open.length, start + open.length);
  }
  ta.focus();
}

function updateToolbarState() {
  const ta    = document.getElementById('editContent');
  const value = ta.value;
  const start = ta.selectionStart;

  const lineStart  = value.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = value.indexOf('\n', start);
  const line = value.slice(lineStart, lineEndIdx === -1 ? value.length : lineEndIdx);

  let current = 'body';
  if      (/^#### /.test(line)) current = 'h4';
  else if (/^### /.test(line))  current = 'h3';
  else if (/^## /.test(line))   current = 'h2';
  else if (/^# /.test(line))    current = 'h1';
  else if (/^<p class="caption">/.test(line)) current = 'caption';

  document.querySelectorAll('.toolbar-btn[data-format]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.format === current);
  });
}

// ─── Category Management ──────────────────────────────────────────────────────

function openCategoryModal() {
  document.getElementById('catName').value = '';
  document.getElementById('catIcon').value = '';
  state.selectedColor = COLORS[0];
  document.querySelectorAll('.color-swatch').forEach((el, i) => {
    el.classList.toggle('selected', i === 0);
  });
  openModal('catOverlay');
}

async function createCategory() {
  const name = document.getElementById('catName').value.trim();
  if (!name) {
    document.getElementById('catName').focus();
    showToast('カテゴリ名を入力してください', 'error');
    return;
  }
  const icon  = document.getElementById('catIcon').value.trim() || '■';
  const color = state.selectedColor;

  try {
    await api.createCategory({ name, icon, color });
    closeModal('catOverlay');
    showToast(`「${name}」を追加しました`, 'success');
    await loadCategories();
    await loadManuals();
  } catch (e) {
    showToast(e.message || 'カテゴリの追加に失敗しました', 'error');
  }
}

function confirmDeleteCategory(evt, id, name) {
  evt.stopPropagation();
  showConfirm(
    `カテゴリ「${name}」を削除しますか？\nこのカテゴリのマニュアルはカテゴリなしになります。`,
    async () => {
      try {
        await api.deleteCategory(id);
        showToast('削除しました', 'success');
        if (state.filterCategory === id) {
          state.filterCategory = null;
          document.getElementById('pageTitle').textContent = 'すべてのマニュアル';
        }
        await loadCategories();
        await loadManuals();
      } catch (e) {
        showToast('削除に失敗しました', 'error');
      }
    }
  );
}

function initColorSwatches() {
  const container = document.getElementById('colorSwatches');
  container.innerHTML = COLORS.map((c, i) =>
    `<div class="color-swatch ${i === 0 ? 'selected' : ''}"
          style="background:${c}"
          onclick="selectColor('${c}', this)"
          title="${c}"></div>`
  ).join('');
}

function selectColor(color, el) {
  state.selectedColor = color;
  document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
}

// ─── OCR ─────────────────────────────────────────────────────────────────────

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('ocrZone').classList.add('drag-over');
}

function handleDragLeave(e) {
  document.getElementById('ocrZone').classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('ocrZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
    handleOCRFile(file);
  } else {
    showToast('画像または PDF ファイルをドロップしてください', 'error');
  }
}

function handleOCRFile(file) {
  if (!file) return;
  state.ocrFile = file;

  const isPdf = file.type === 'application/pdf';
  const imgEl   = document.getElementById('ocrPreviewImg');
  const labelEl = document.getElementById('ocrPdfLabel');

  if (isPdf) {
    imgEl.style.display   = 'none';
    labelEl.style.display = '';
    labelEl.textContent   = `📄 ${file.name}`;
  } else {
    labelEl.style.display = 'none';
    imgEl.style.display   = '';
    const reader = new FileReader();
    reader.onload = (e) => { imgEl.src = e.target.result; };
    reader.readAsDataURL(file);
  }

  document.getElementById('ocrEmpty').style.display  = 'none';
  document.getElementById('ocrLoaded').style.display = '';
  document.getElementById('ocrResult').style.display = 'none';
  state.ocrText = '';
}

async function runOCR() {
  if (!state.ocrFile) return;

  const btn = document.getElementById('ocrRunBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>読み取り中...';

  try {
    const result = await api.ocr(state.ocrFile);
    state.ocrText = result.transcription;
    document.getElementById('ocrResultText').textContent = state.ocrText;
    document.getElementById('ocrResult').style.display = '';
    showToast('読み取りが完了しました', 'success');
  } catch (e) {
    showToast(e.message || 'OCRに失敗しました', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'テキストを読み取る';
  }
}

function insertOCRText() {
  if (!state.ocrText) return;
  const ta = document.getElementById('editContent');
  const pos = ta.selectionEnd;
  const before = ta.value.slice(0, pos);
  const after  = ta.value.slice(pos);
  const sep    = before && !before.endsWith('\n') ? '\n\n' : '';
  ta.value = before + sep + state.ocrText + '\n' + after;
  setEditorMode('edit');
  showToast('テキストを挿入しました', 'success');
}

function clearOCR() {
  state.ocrFile = null;
  state.ocrText = '';
  document.getElementById('ocrFileInput').value      = '';
  document.getElementById('ocrPreviewImg').src        = '';
  document.getElementById('ocrPreviewImg').style.display = '';
  document.getElementById('ocrPdfLabel').style.display   = 'none';
  document.getElementById('ocrEmpty').style.display  = '';
  document.getElementById('ocrLoaded').style.display = 'none';
  document.getElementById('ocrResult').style.display = 'none';
}

// ─── Mobile Sidebar ───────────────────────────────────────────────────────────

function openSidebar() {
  document.getElementById('appSidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  document.getElementById('appSidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('visible');
  document.body.style.overflow = '';
}

// ─── Modal Helpers ────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById(id).style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  // Re-enable scroll only if no other overlay is open
  const anyOpen = document.querySelector('.overlay[style*="flex"]');
  if (!anyOpen) document.body.style.overflow = '';
}

function overlayClick(e, id) {
  if (e.target === e.currentTarget) closeModal(id);
}

// Close modals with Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['detailOverlay', 'editOverlay', 'catOverlay', 'confirmOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.style.display !== 'none') closeModal(id);
    });
  }
});

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function showConfirm(msg, onOk) {
  document.getElementById('confirmMsg').textContent = msg;
  const btn = document.getElementById('confirmOkBtn');
  const clone = btn.cloneNode(true);
  btn.parentNode.replaceChild(clone, btn);
  clone.addEventListener('click', () => { closeModal('confirmOverlay'); onOk(); });
  openModal('confirmOverlay');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
}
