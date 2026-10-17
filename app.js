'use strict';
const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 48;
const RELEASE = 'https://github.com/byeonghoyoo/reactor-prompts-magazine/releases/download/snapshot-2026-10-17/';
let posts = [], categories = {}, translations = {}, activeCategory = '', currentPage = 1, selected = null, selectedImage = 0, filtered = [];
const number = (value) => Number(value).toLocaleString('ko-KR');

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text ?? '');
  if (className) node.className = className;
  return node;
}
function cleanCaption(value) {
  if (typeof value !== 'string') return '';
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => {
    const commentNotice = /(?:프롬|프론프트|프롭프트|프름|링크|신청|요강|다운로드).*댓글|댓글.*(?:프롬|프론프트|프롭프트|프름|링크)|^[\s\p{P}\p{S}]*댓글(?:에|로|에서)?\s*(?:있어|봐|확인|주르륵|$)/u.test(line);
    const collectionNotice = /(?:그\s*동안|계정의|모든).*프롬프트.*(?:여기에|다\s*있어)/u.test(line);
    const publisherNotice = /^(?:배포자|게시자|작성자|출처)\s*[:：]/u.test(line);
    const collectionLink = /(?:reactorprompt\.vercel\.app|reactor-prompts-magazine\.pages\.dev)/i.test(line);
    return !commentNotice && !collectionNotice && !publisherNotice && !collectionLink;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function placeholder() { return element('span', '원본에서 불러올 수 없는 이미지', 'placeholder'); }
function makeImage(src, alt) {
  const image = document.createElement('img');
  image.src = src; image.alt = alt; image.loading = 'lazy'; image.decoding = 'async';
  image.addEventListener('error', () => image.replaceWith(placeholder()), {once: true});
  return image;
}
function renderCategories() {
  $('categories').replaceChildren();
  for (const [key, label] of [['', '전체'], ...Object.entries(categories)]) {
    const button = element('button', label);
    button.setAttribute('aria-pressed', String(key === activeCategory));
    button.onclick = () => { activeCategory = key; currentPage = 1; renderCategories(); filter(); };
    $('categories').append(button);
  }
}
function filter() {
  const query = $('search').value.trim().toLocaleLowerCase();
  filtered = posts.filter((post) => (!activeCategory || post.tags.includes(activeCategory)) &&
    (!$('prompt-only').checked || !!post.prompt) && (!query || post.searchText.includes(query)));
  if ($('sort').value === 'id-desc') filtered.sort((a,b) => Number(b.id) - Number(a.id));
  if ($('sort').value === 'id-asc') filtered.sort((a,b) => Number(a.id) - Number(b.id));
  currentPage = Math.min(currentPage, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  render();
}
function render() {
  const fragment = document.createDocumentFragment();
  for (const post of filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)) {
    const card = element('button', undefined, 'card');
    card.setAttribute('aria-label', `${post.caption || '제목 없는 작품'} 상세 보기`);
    const visual = element('div', undefined, 'card-visual');
    visual.append(post.thumbnail ? makeImage(post.thumbnail, post.caption || '갤러리 이미지') : placeholder());
    visual.append(element('span', `${post.images.length}장`, 'image-badge'));
    const meta = element('div', undefined, 'card-meta');
    meta.append(element('span', `No. ${post.id}`), element('span', post.prompt ? '프롬프트 수록' : '이미지 작품'));
    card.append(visual, element('h2', post.caption || '제목 없는 작품'), meta);
    card.onclick = () => openDetail(post);
    fragment.append(card);
  }
  $('gallery').replaceChildren(fragment);
  $('gallery').setAttribute('aria-busy', 'false');
  $('result-count').textContent = `${number(filtered.length)}개 작품`;
  $('empty').hidden = filtered.length > 0;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  $('page-number').textContent = `${currentPage} / ${totalPages}`;
  $('previous').disabled = currentPage === 1;
  $('next').disabled = currentPage >= totalPages;
}
function renderImage() {
  const image = selected?.images[selectedImage];
  $('image-stage').replaceChildren(image?.status === 'ok' ? makeImage(image.preview, selected.caption) : placeholder());
  $('image-number').textContent = selected?.images.length ? `${selectedImage + 1} / ${selected.images.length}` : '이미지 없음';
  $('image-previous').disabled = selectedImage <= 0;
  $('image-next').disabled = !selected || selectedImage >= selected.images.length - 1;
  $('preview-download').hidden = image?.status !== 'ok';
  $('original-download').hidden = !image?.archive;
  $('detail-status').textContent = image?.status === 'ok' ? '미리보기는 용량을 줄인 이미지입니다. 원본은 해당 ZIP에 보관되어 있습니다.' : '보관 시점에 원본 이미지 서버에서 파일을 제공하지 않았습니다. 프롬프트와 원본 경로는 보존했습니다.';
  if (image?.status === 'ok') {
    $('preview-download').href = image.preview;
    $('preview-download').download = `reactor-${selected.id}-${selectedImage+1}.webp`;
  }
  if (image?.archive) {
    $('original-download').href = RELEASE + encodeURIComponent(image.archive);
    $('original-download').textContent = `원본 ZIP ${image.archive.match(/(\d+)\.zip$/)?.[1] || ''}`;
    $('original-download').title = `ZIP 안의 파일: ${image.path}`;
  }
}
function renderPrompt() {
  if (!selected) return;
  const language = $('language').value;
  const translated = language === 'original' ? '' : translations[language]?.[`prompt_${selected.id}`];
  const prompt = typeof translated === 'string' && translated.trim() ? translated : selected.prompt;
  $('prompt-text').textContent = prompt || '등록된 프롬프트가 없습니다.';
  $('translation-note').textContent = language !== 'original' && !translated && selected.prompt ? '이 언어의 원본 번역이 없어 원문을 표시합니다.' : '';
  $('copy').disabled = !prompt;
  $('copy').textContent = '프롬프트 복사';
}
function openDetail(post) {
  selected = post; selectedImage = 0;
  $('detail-title').textContent = post.caption || '제목 없는 작품';
  $('detail-meta').textContent = `No. ${post.id}${post.date_display ? ' / ' + post.date_display : ''}`;
  $('detail-tags').textContent = post.tags.map((tag) => categories[tag] || tag).join(' · ');
  renderImage(); renderPrompt();
  $('detail').showModal();
  $('detail').scrollTop = 0;
}
function changePage(delta) {
  currentPage += delta; render();
  $('categories').scrollIntoView({block: 'start'});
}
$('search').addEventListener('input', () => { currentPage = 1; filter(); });
$('prompt-only').addEventListener('change', () => { currentPage = 1; filter(); });
$('sort').addEventListener('change', () => { currentPage = 1; filter(); });
$('previous').onclick = () => changePage(-1);
$('next').onclick = () => changePage(1);
$('close').onclick = () => $('detail').close();
$('image-previous').onclick = () => { if (selectedImage > 0) { selectedImage--; renderImage(); } };
$('image-next').onclick = () => { if (selected && selectedImage < selected.images.length - 1) { selectedImage++; renderImage(); } };
$('language').onchange = renderPrompt;
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('prompt-text').textContent); $('copy').textContent = '복사했습니다'; }
  catch { $('detail-status').textContent = '복사가 허용되지 않았습니다. 프롬프트 텍스트를 선택해서 복사해 주세요.'; }
};
$('detail').addEventListener('click', (event) => { if (event.target === $('detail')) { const rect = $('detail').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('detail').close(); } });

async function init() {
  try {
    const response = await fetch('./gallery.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.posts)) throw new Error('Invalid gallery data');
    categories = data.categories || {};
    posts = data.posts.map((post) => ({...post, caption: cleanCaption(post.caption), prompt: typeof post.prompt === 'string' ? post.prompt : '', tags: Array.isArray(post.tags) ? post.tags : [], images: Array.isArray(post.images) ? post.images : []}));
    for (const post of posts) post.searchText = [post.id, post.caption, post.prompt, ...post.tags.map((tag) => categories[tag] || tag)].join(' ').toLocaleLowerCase();
    const summary = data.summary;
    $('summary').textContent = `${number(summary.posts)}개 작품 / ${number(summary.posts_with_prompt)}개 프롬프트 / ${number(summary.saved_images)}장 보관`;
    $('coverage').textContent = `2026년 10월 17일 기준. 원본 데이터의 이미지 ${number(summary.image_references)}장 중 ${number(summary.saved_images)}장을 보관했습니다. ${number(summary.missing_images)}장은 원본 서버에서 불러올 수 없었습니다. 전체 ${number(summary.posts)}개 게시물과 프롬프트 원문은 그대로 보존했습니다.`;
    for (const archive of summary.archives) {
      const link = element('a', `${archive.name} (${(archive.bytes/2**20).toFixed(0)} MB)`);
      link.href = RELEASE + encodeURIComponent(archive.name);
      $('archives').append(link);
    }
    renderCategories(); filter();
  } catch (error) {
    $('summary').textContent = '아카이브를 불러오지 못했습니다.';
    $('load-error').hidden = false;
    $('load-error').textContent = `데이터를 불러오지 못했습니다 (${error.message}). 페이지를 새로고침해 주세요. GitHub에서 프롬프트 파일을 직접 받을 수도 있습니다.`;
    $('gallery').setAttribute('aria-busy', 'false');
  }
  try { const response = await fetch('./source/translations.json'); if (response.ok) { translations = await response.json(); renderPrompt(); } } catch { /* Original prompt remains available. */ }
}
init();
