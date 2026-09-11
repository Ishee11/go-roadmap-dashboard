import { load as parseYaml } from 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm';

const app = document.querySelector('#app');
const privateRepoBase = 'https://github.com/Ishee11/go-learning-roadmap/blob/main/';

const catalogSources = [
  './data/skills.yaml',
  './data/skills-p1.yaml',
];
const progressSources = [
  './data/skill-progress.yaml',
  './data/skill-progress-p1.yaml',
];

async function fetchYaml(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(path);
  return parseYaml(await response.text());
}

const [catalogParts, progressParts] = await Promise.all([
  Promise.all(catalogSources.map(fetchYaml)),
  Promise.all(progressSources.map(fetchYaml)),
]);

const baseCatalog = catalogParts[0];
const catalog = {
  ...baseCatalog,
  blocks: catalogParts.flatMap(part => part.blocks ?? []),
  skills: catalogParts.flatMap(part => part.skills ?? []),
};
const progress = {
  updated_at: progressParts.map(part => part.updated_at).filter(Boolean).sort().at(-1),
  skills: Object.assign({}, ...progressParts.map(part => part.skills ?? {})),
};

const rankOf = code => code ? (catalog.level_scale?.[code]?.rank ?? -1) : -1;
const labelOf = code => code ? (catalog.level_scale?.[code]?.label ?? code) : 'Не проверено';
const currentCode = entry => entry ? `${entry.current.level}.${entry.current.stage}` : null;
const blockById = new Map(catalog.blocks.map(x => [x.id, x]));
const priorityOf = item => blockById.get(item.skill.block)?.priority ?? 'P0';
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;

function evaluate(skill) {
  const entry = progress.skills?.[skill.id];
  const current = currentCode(entry);
  const currentRank = rankOf(current);
  const minRank = skill.min ? rankOf(skill.min) : null;
  const targetRank = rankOf(skill.target);
  const targetMet = Boolean(entry && entry.current.confirmation === 'confirmed' && currentRank >= targetRank);
  let minStatus;
  if (skill.min == null) minStatus = 'not_required';
  else if (!entry) minStatus = 'unassessed';
  else if (currentRank >= minRank) minStatus = entry.current.confirmation === 'confirmed' ? 'min_met' : 'needs_confirmation';
  else minStatus = 'below_min';
  return { skill, entry, current, currentRank, minRank, targetRank, targetMet, minStatus };
}

const evaluated = catalog.skills.map(evaluate);
const byId = new Map(evaluated.map(x => [x.skill.id, x]));
const blockOrder = new Map(catalog.blocks.map((b, i) => [b.id, i]));
const priorities = [...new Set(catalog.blocks.map(block => block.priority ?? 'P0'))];

let priority = priorities.includes('P0') ? 'P0' : priorities[0];
let filter = 'all';
let selectedBlockId = null;
let selectedSkillId = null;

function scopedItems() {
  return evaluated.filter(item => priorityOf(item) === priority);
}

function scopedBlocks() {
  const ids = new Set(scopedItems().map(item => item.skill.block));
  return catalog.blocks.filter(block => ids.has(block.id));
}

function gapItems(items = scopedItems()) {
  return items
    .filter(x => x.skill.min != null && x.minStatus !== 'min_met' && !x.targetMet)
    .sort((a, b) => {
      const weight = x => x.minStatus === 'needs_confirmation' ? 0 : (x.entry ? 1 : 2);
      const wd = weight(a) - weight(b);
      if (wd) return wd;
      const da = Math.max(0, (a.minRank ?? 999) - a.currentRank);
      const db = Math.max(0, (b.minRank ?? 999) - b.currentRank);
      if (da !== db) return da - db;
      return (blockOrder.get(a.skill.block) ?? 99) - (blockOrder.get(b.skill.block) ?? 99);
    });
}

function ensureSelection() {
  const items = scopedItems();
  const blocks = scopedBlocks();
  if (!blocks.some(block => block.id === selectedBlockId)) {
    selectedBlockId = gapItems(items)[0]?.skill.block ?? blocks[0]?.id ?? null;
  }
  if (!items.some(item => item.skill.id === selectedSkillId && item.skill.block === selectedBlockId)) {
    selectedSkillId = gapItems(items).find(item => item.skill.block === selectedBlockId)?.skill.id
      ?? items.find(item => item.skill.block === selectedBlockId)?.skill.id
      ?? items[0]?.skill.id
      ?? null;
  }
}

function bar(value) {
  return `<div class="bar"><span style="width:${value}%"></span></div>`;
}

function levelPath(item) {
  const provisional = item.entry?.current.confirmation === 'provisional' ? '<small> · предварительно</small>' : '';
  return `<div class="levels">
    <div><span class="label">CURRENT</span><strong>${labelOf(item.current)}${provisional}</strong></div><span class="arrow">→</span>
    <div><span class="label">MIN</span><strong>${item.skill.min ? labelOf(item.skill.min) : 'не обязателен'}</strong></div><span class="arrow">→</span>
    <div><span class="label">TARGET</span><strong>${labelOf(item.skill.target)}</strong></div>
  </div>`;
}

function statusMeta(item) {
  if (item.targetMet) return ['TARGET', 'target'];
  if (item.minStatus === 'min_met') return ['MIN закрыт', 'min'];
  if (item.minStatus === 'needs_confirmation') return ['Подтвердить', 'confirm'];
  if (item.minStatus === 'not_required') return ['Не блокирует MIN', 'neutral'];
  if (item.minStatus === 'unassessed') return ['Не проверено', 'gap'];
  return ['Ниже MIN', 'gap'];
}

function status(item) {
  const [text, cls] = statusMeta(item);
  return `<span class="status ${cls}">${text}</span>`;
}

function nextEvidence(code) {
  if (!code) return 'Навык не блокирует minimum pass; углубление можно отложить.';
  if (code === 'understanding.explanation') return 'Самостоятельно объяснить модель своими словами.';
  if (code === 'understanding.comparison') return 'Сравнить с близким подходом и назвать существенные отличия.';
  if (code === 'understanding.contextualization') return 'Самостоятельно объяснить, где и зачем применяется механизм.';
  if (code === 'application.template') return 'Решить практическую задачу по знакомому шаблону.';
  if (code === 'application.variable') return 'Адаптировать знакомый подход под новую формулировку.';
  if (code === 'application.independent') return 'Решить новую практическую задачу без существенных подсказок.';
  if (code.startsWith('analysis.')) return 'Разобрать незнакомое решение и самостоятельно найти связи, причины или дефекты.';
  if (code.startsWith('synthesis.')) return 'Собрать решение из нескольких знакомых механизмов.';
  if (code.startsWith('evaluation.')) return 'Аргументированно выбрать между альтернативами и объяснить trade-offs.';
  return 'Самостоятельно воспроизвести ключевую модель без подсказки.';
}

function blockStats(block, items) {
  const blockItems = items.filter(x => x.skill.block === block.id);
  const req = blockItems.filter(x => x.skill.min != null);
  const met = req.filter(x => x.targetMet || x.minStatus === 'min_met').length;
  return {
    items: blockItems,
    req,
    met,
    percent: pct(met, req.length),
    target: blockItems.filter(x => x.targetMet).length,
    confirm: blockItems.filter(x => x.minStatus === 'needs_confirmation').length,
  };
}

function visible(item) {
  if (filter === 'all') return true;
  if (filter === 'gaps') return ['below_min', 'unassessed'].includes(item.minStatus);
  if (filter === 'confirm') return item.minStatus === 'needs_confirmation';
  if (filter === 'min') return item.minStatus === 'min_met' && !item.targetMet;
  if (filter === 'target') return item.targetMet;
  return true;
}

function render() {
  ensureSelection();

  const items = scopedItems();
  const blocks = scopedBlocks();
  const gaps = gapItems(items);
  const selectedBlock = blockById.get(selectedBlockId) ?? blocks[0];
  const selected = byId.get(selectedSkillId) ?? gaps[0] ?? items[0];
  const suggested = gaps[0] ?? items[0];

  if (!selectedBlock || !selected || !suggested) {
    app.innerHTML = '<p class="loading">Для выбранного приоритета пока нет навыков.</p>';
    return;
  }

  const required = items.filter(x => x.skill.min != null);
  const minMet = required.filter(x => x.targetMet || x.minStatus === 'min_met').length;
  const targetMet = items.filter(x => x.targetMet).length;
  const needsConfirmation = required.filter(x => x.minStatus === 'needs_confirmation').length;

  const blocksHtml = blocks.map(block => {
    const s = blockStats(block, items);
    return `<button class="block ${block.id === selectedBlockId ? 'active' : ''}" data-block="${block.id}">
      <div class="block-top"><strong>${block.title}</strong><span>${s.percent}%</span></div>${bar(s.percent)}
      <div class="block-meta"><span>MIN ${s.met}/${s.req.length}</span><span>TARGET ${s.target}/${s.items.length}</span>${s.confirm ? `<span>confirm ${s.confirm}</span>` : ''}</div>
    </button>`;
  }).join('');

  const groupsHtml = (selectedBlock.groups ?? []).map(group => {
    const groupItems = items.filter(x => x.skill.block === selectedBlockId && x.skill.group === group.id && visible(x));
    if (!groupItems.length) return '';
    return `<section class="group"><h3>${group.title}</h3><div class="skill-list">${groupItems.map(item => `
      <button class="skill ${item.skill.id === selectedSkillId ? 'active' : ''}" data-skill="${item.skill.id}">
        <span class="skill-title"><strong>${item.skill.title}</strong><span>${item.skill.description}</span></span>
        <span class="current">${labelOf(item.current)}</span>${status(item)}
      </button>`).join('')}</div></section>`;
  }).join('');

  const ev = selected.entry?.evidence?.length
    ? `<ul class="evidence">${selected.entry.evidence.map(e => `<li><a href="${privateRepoBase}${e.ref}" target="_blank" rel="noreferrer">${e.ref}</a><small>${e.type ?? 'evidence'}${e.date ? ` · ${e.date}` : ''}</small></li>`).join('')}</ul>`
    : '<p>Подтверждающих записей пока нет.</p>';

  const nextHtml = gaps.slice(0, 8).map((item, i) => `<button class="next-item" data-skill="${item.skill.id}" data-block="${item.skill.block}">
    <span class="idx">${String(i + 1).padStart(2, '0')}</span><span class="next-main"><strong>${item.skill.title}</strong><small>${blockById.get(item.skill.block)?.title ?? ''}</small></span>
    <span class="next-level">${labelOf(item.current)} → ${labelOf(item.skill.min)}</span>${status(item)}</button>`).join('');

  const priorityTabs = priorities.map(p => `<button data-priority="${p}" class="${priority === p ? 'active' : ''}">${p}</button>`).join('');
  const scopeDescription = priority === 'P0'
    ? 'Обязательный слой: сначала закрываем MIN по базовым навыкам Go backend middle.'
    : 'Следующий слой interview readiness: углубляем production-темы, не смешивая их с P0 readiness.';

  app.innerHTML = `
    <header class="hero"><div><span class="eyebrow">${priority} · ${catalog.objective}</span><h1>Go Middle Readiness</h1><p>${scopeDescription}</p><div class="filters" style="justify-content:flex-start;margin-top:14px">${priorityTabs}</div></div><div class="updated">Данные: ${progress.updated_at}</div></header>
    <section class="metrics">
      <article class="metric primary"><div class="metric-row"><span class="eyebrow">${priority} MINIMUM</span><strong>${pct(minMet, required.length)}%</strong></div>${bar(pct(minMet, required.length))}<p><b>${minMet}</b> из <b>${required.length}</b> обязательных MIN подтверждены</p></article>
      <article class="metric"><span class="eyebrow">TARGET coverage</span><strong class="big">${targetMet}/${items.length}</strong><p>${pct(targetMet, items.length)}% навыков дошли до целевого уровня</p></article>
      <article class="metric"><span class="eyebrow">Открытые MIN</span><strong class="big">${required.length - minMet}</strong><p>из них ${needsConfirmation} требуют короткого подтверждения</p></article>
    </section>
    <section class="focus"><div><span class="eyebrow">Ближайший gap · ${priority}</span><h2>${suggested.skill.title}</h2><p>${suggested.skill.description}</p></div>${levelPath(suggested)}<div class="focus-next"><span class="label">Следующее evidence</span><strong>${nextEvidence(suggested.skill.min)}</strong></div></section>
    <section class="section card" style="padding:24px"><div class="section-head"><div><span class="eyebrow">${priority} blocks</span><h2 class="section-title">Карта готовности</h2></div><p>Приоритеты считаются отдельно: P1 не снижает P0 readiness.</p></div><div class="blocks">${blocksHtml}</div></section>
    <section class="layout section">
      <div class="panel"><div class="toolbar"><div><span class="eyebrow">Roadmap · ${priority}</span><h2 class="section-title">${selectedBlock.title}</h2></div><div class="filters">${[['all','Все'],['gaps','Ниже MIN'],['confirm','Подтвердить'],['min','MIN'],['target','TARGET']].map(([v,t]) => `<button data-filter="${v}" class="${filter === v ? 'active' : ''}">${t}</button>`).join('')}</div></div>${groupsHtml || '<p style="color:var(--muted)">В этом фильтре навыков нет.</p>'}</div>
      <aside class="detail">${status(selected)}<h2>${selected.skill.title}</h2><p>${selected.skill.description}</p>${levelPath(selected)}
        <div class="detail-section"><span class="label">Следующее evidence</span><p>${nextEvidence(selected.skill.min)}</p></div>
        ${selected.entry?.note ? `<div class="detail-section"><span class="label">Почему CURRENT такой</span><p>${selected.entry.note}</p></div>` : ''}
        <div class="detail-section"><span class="label">Evidence</span>${ev}</div>
      </aside>
    </section>
    <section class="section card" style="padding:24px"><div class="section-head"><div><span class="eyebrow">Next · ${priority}</span><h2 class="section-title">Ближайшие gaps</h2></div><p>Сначала короткие подтверждения, затем навыки, которые ближе всего к MIN.</p></div><div class="next-list">${nextHtml || '<p style="color:var(--muted)">Все обязательные MIN этого слоя закрыты.</p>'}</div></section>
    <footer>Публичная read-only визуализация. Source of truth остаётся в private learning repository; P0 и P1 считаются независимо из опубликованных YAML.</footer>`;

  app.querySelectorAll('[data-priority]').forEach(btn => btn.addEventListener('click', () => {
    priority = btn.dataset.priority;
    selectedBlockId = null;
    selectedSkillId = null;
    filter = 'all';
    render();
  }));
  app.querySelectorAll('[data-block]').forEach(btn => btn.addEventListener('click', () => {
    selectedBlockId = btn.dataset.block;
    if (!btn.dataset.skill) selectedSkillId = items.find(x => x.skill.block === selectedBlockId)?.skill.id ?? selectedSkillId;
    if (btn.dataset.skill) selectedSkillId = btn.dataset.skill;
    filter = 'all';
    render();
  }));
  app.querySelectorAll('[data-skill]').forEach(btn => btn.addEventListener('click', () => {
    selectedSkillId = btn.dataset.skill;
    selectedBlockId = byId.get(selectedSkillId)?.skill.block ?? selectedBlockId;
    render();
  }));
  app.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    render();
  }));
}

render();
