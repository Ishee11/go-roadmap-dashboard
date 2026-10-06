import { load as parseYaml } from 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm';

const app = document.querySelector('#app');
const privateRepoBase = 'https://github.com/Ishee11/go-learning-roadmap/blob/main/';
const DATA_VERSION = '2026-10-06-9';

function showLoadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  app.innerHTML = `<div class="loading">Не удалось загрузить карту прогресса: ${message}</div>`;
}

window.addEventListener('unhandledrejection', event => {
  showLoadError(event.reason);
});

async function fetchYaml(path) {
  try {
    const url = new URL(path, window.location.href);
    url.searchParams.set('v', DATA_VERSION);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return parseYaml(await response.text());
  } catch (error) {
    showLoadError(error);
    throw error;
  }
}

const [manifest, experienceData] = await Promise.all([
  fetchYaml('./data/catalogs.yaml'),
  fetchYaml('./data/experience.yaml'),
]);
const layerData = await Promise.all((manifest.layers ?? []).map(async layer => {
  const [layerCatalog, layerProgress] = await Promise.all([
    fetchYaml(`./data/${layer.catalog}`),
    fetchYaml(`./data/${layer.progress}`),
  ]);
  return { meta: layer, catalog: layerCatalog, progress: layerProgress };
}));

// Public P0 updates override the immutable base snapshot. Keep this
// manifest in sync with the published per-skill YAML files.
const p0Layer = layerData.find(layer => layer.meta.priority === 'P0');
if (p0Layer) {
  const shardManifest = await fetchYaml('./data/skill-progress.d/manifest.yaml');
  if (!Array.isArray(shardManifest.skills)) throw new Error('Invalid skill-progress shard manifest');
  const shardEntries = await Promise.all(shardManifest.skills.map(async skillId => ({
    skillId,
    update: await fetchYaml(`./data/skill-progress.d/${skillId}.yaml`),
  })));
  for (const { skillId, update } of shardEntries) {
    const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const validReview = !update?.review || (
      validDate(update.review.last_at) &&
      validDate(update.review.next_at) &&
      Number.isInteger(update.review.interval_days) &&
      update.review.interval_days >= 1
    );
    if (!update?.current || !Array.isArray(update.evidence) || !validReview) {
      throw new Error(`Invalid skill progress update: ${skillId}`);
    }
    const { updated_at, ...entry } = update;
    p0Layer.progress.skills[skillId] = entry;
    if (updated_at > p0Layer.progress.updated_at) p0Layer.progress.updated_at = updated_at;
  }
}

const baseLayer = layerData.find(layer => layer.meta.priority === manifest.default_priority) ?? layerData[0];
if (!baseLayer) throw new Error('data/catalogs.yaml has no layers');

const catalog = {
  ...baseLayer.catalog,
  blocks: layerData.flatMap(({ meta, catalog: part }) =>
    (part.blocks ?? []).map(block => ({ ...block, priority: block.priority ?? meta.priority }))),
  skills: layerData.flatMap(({ catalog: part }) => part.skills ?? []),
};
const progress = {
  updated_at: layerData.map(layer => layer.progress.updated_at).filter(Boolean).sort().at(-1),
  skills: Object.assign({}, ...layerData.map(layer => layer.progress.skills ?? {})),
};
const priorityMeta = new Map(layerData.map(layer => [layer.meta.priority, layer.meta]));

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
const skillOrder = new Map(catalog.skills.map((skill, i) => [skill.id, i]));
const priorities = layerData.map(layer => layer.meta.priority);
const tabs = [...priorities, 'experience'];

let priority = manifest.default_priority ?? priorities[0];
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

function hasOpenMinimum(item) {
  return item.skill.min != null && item.minStatus !== 'min_met' && !item.targetMet;
}

function openHardUnlockCount(item, items) {
  return items.filter(candidate =>
    hasOpenMinimum(candidate) &&
    (candidate.skill.depends_on ?? [])
      .map(normalizeDependency)
      .some(dependency => dependency.id === item.skill.id && dependency.gate === 'hard')
  ).length;
}

function studyPriorityTier(item, items, today) {
  if (hasOpenMinimum(item) && isLocked(item)) return 99;
  const review = reviewState(item, today);
  if (review === 'due' || review === 'overdue') return 0;
  if (item.entry?.active_issue?.type === 'misconception') return 1;
  if (hasOpenMinimum(item) && openHardUnlockCount(item, items) > 0) return 2;
  if (item.minStatus === 'needs_confirmation') return 3;
  if (item.minStatus === 'below_min') return 4;
  if (item.minStatus === 'unassessed') return 5;
  return 6;
}

function compareStudyPriority(a, b, items, today) {
  const tierDiff = studyPriorityTier(a, items, today) - studyPriorityTier(b, items, today);
  if (tierDiff) return tierDiff;

  const tier = studyPriorityTier(a, items, today);
  if (tier === 0) {
    const aDate = a.entry?.review?.next_at ?? '9999-12-31';
    const bDate = b.entry?.review?.next_at ?? '9999-12-31';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
  }

  const deficit = item => {
    if (!item.entry) return 999;
    return item.minRank == null ? 999 : Math.max(0, item.minRank - item.currentRank);
  };
  const deficitDiff = deficit(a) - deficit(b);
  if (deficitDiff) return deficitDiff;

  if (tier === 2) {
    const unlockDiff = openHardUnlockCount(b, items) - openHardUnlockCount(a, items);
    if (unlockDiff) return unlockDiff;
  }

  const blockDiff = (blockOrder.get(a.skill.block) ?? 99) - (blockOrder.get(b.skill.block) ?? 99);
  if (blockDiff) return blockDiff;
  return (skillOrder.get(a.skill.id) ?? 999) - (skillOrder.get(b.skill.id) ?? 999);
}

function studyPriorityReason(item, items, today) {
  const review = reviewState(item, today);
  if (review === 'overdue') return 'Просроченное интервальное повторение.';
  if (review === 'due') return 'Интервальное повторение назначено на сегодня.';
  if (item.entry?.active_issue?.type === 'misconception') {
    return 'Активный misconception: сначала нужно исправить причинную модель.';
  }
  const unlockCount = openHardUnlockCount(item, items);
  if (hasOpenMinimum(item) && unlockCount > 0) {
    return `Hard prerequisite для ${unlockCount} незакрытых skills этого слоя.`;
  }
  if (item.minStatus === 'needs_confirmation') {
    return 'MIN уже достигнут предварительно: выгоднее закрыть Transfer Check.';
  }
  if (item.minStatus === 'below_min') {
    return 'Разблокированный gap ниже MIN; среди равных выбран ближайший к MIN.';
  }
  if (item.minStatus === 'unassessed') return 'Не проверено: следующий шаг — Frontier Check.';
  return 'Поддерживающее повторение подтверждённого навыка.';
}

function gapItems(items = scopedItems()) {
  const today = localTodayIso();
  return items
    .filter(hasOpenMinimum)
    .sort((a, b) => compareStudyPriority(a, b, items, today));
}

function studyItems(items = scopedItems()) {
  const today = localTodayIso();
  return items
    .filter(item => {
      const review = reviewState(item, today);
      const dueReview = review === 'due' || review === 'overdue';
      const misconception = item.entry?.active_issue?.type === 'misconception';
      const openMinimum = hasOpenMinimum(item);
      if (!dueReview && !misconception && !openMinimum) return false;
      if (openMinimum && isLocked(item)) return false;
      return true;
    })
    .sort((a, b) => compareStudyPriority(a, b, items, today));
}

function ensureSelection() {
  const items = scopedItems();
  const blocks = scopedBlocks();
  const queue = studyItems(items);
  if (!blocks.some(block => block.id === selectedBlockId)) {
    selectedBlockId = queue[0]?.skill.block ?? gapItems(items)[0]?.skill.block ?? blocks[0]?.id ?? null;
  }
  if (!items.some(item => item.skill.id === selectedSkillId && item.skill.block === selectedBlockId)) {
    selectedSkillId = queue.find(item => item.skill.block === selectedBlockId)?.skill.id
      ?? gapItems(items).find(item => item.skill.block === selectedBlockId)?.skill.id
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

function normalizeDependency(dependency) {
  return typeof dependency === 'string'
    ? { id: dependency, gate: 'soft' }
    : dependency;
}

function dependencyState(relation, item) {
  const requiredCode = relation.required ?? (relation.gate === 'hard' ? item.skill.min : null);
  if (!requiredCode) return { requiredCode, satisfied: true };
  return {
    requiredCode,
    satisfied: Boolean(
      item.entry &&
      item.entry.current.confirmation === 'confirmed' &&
      item.currentRank >= rankOf(requiredCode)
    ),
  };
}

function dependenciesOf(item) {
  return (item.skill.depends_on ?? [])
    .map(normalizeDependency)
    .map(relation => {
      const dependency = byId.get(relation.id);
      if (!dependency) return null;
      const state = dependencyState(relation, dependency);
      return { relation, item: dependency, requiredCode: state.requiredCode, satisfied: state.satisfied };
    })
    .filter(Boolean);
}

function unlocksOf(item) {
  return evaluated.filter(candidate =>
    (candidate.skill.depends_on ?? [])
      .map(normalizeDependency)
      .some(dependency => dependency.id === item.skill.id && dependency.gate === 'hard')
  );
}

function hardBlockersOf(item) {
  if (item.targetMet || item.minStatus === 'min_met' || item.minStatus === 'not_required') return [];
  return dependenciesOf(item).filter(dependency =>
    dependency.relation.gate === 'hard' && !dependency.satisfied
  );
}

function isLocked(item) {
  return hardBlockersOf(item).length > 0;
}

function localTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayDistance(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

function reviewState(item, today = localTodayIso()) {
  const nextAt = item.entry?.review?.next_at;
  if (!nextAt) return 'none';
  if (nextAt < today) return 'overdue';
  if (nextAt === today) return 'due';
  return 'upcoming';
}

function reviewStatusText(item, today = localTodayIso()) {
  const nextAt = item.entry?.review?.next_at;
  if (!nextAt) return 'Не назначено';
  const distance = dayDistance(today, nextAt);
  if (distance < 0) return `Просрочено на ${Math.abs(distance)} дн.`;
  if (distance === 0) return 'Нужно повторить сегодня';
  return `Через ${distance} дн.`;
}

function formatReviewDate(value) {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}
function nextStep(item, blockers) {
  if (blockers.length) {
    const blocker = blockers[0];
    return `Заблокировано: сначала ${blocker.item.skill.title} до уровня ${labelOf(blocker.requiredCode)}.`;
  }
  if (item.entry?.active_issue) {
    const issue = item.entry.active_issue;
    return issue.type === 'misconception'
      ? `Исправить misconception через theory_first: ${issue.summary}`
      : `Закрыть gap: ${issue.summary}`;
  }
  if (item.minStatus === 'needs_confirmation') return 'Transfer Check: применить тот же принцип в другом контексте без подсказок.';
  const reviewStateNow = reviewState(item);
  if (reviewStateNow === 'due' || reviewStateNow === 'overdue') return 'Интервальное повторение: новая активная проверка без перечитывания конспекта.';
  if (item.targetMet) return 'TARGET подтверждён: удерживать навык интервальными проверками.';
  if (item.minStatus === 'unassessed') return 'Frontier Check: определить фактический CURRENT до уровня MIN.';
  if (item.minStatus === 'below_min') return 'Практика от текущего уровня к MIN без повторного прохождения уже подтверждённого.';
  if (item.minStatus === 'min_met') return 'MIN закрыт: следующий шаг — движение к TARGET по приоритету.';
  return 'Навык не блокирует MIN; углубление можно отложить.';
}

function dependencyRelationHtml(dependency) {
  const blocking = dependency.relation.gate === 'hard' && !dependency.satisfied;
  const meta = dependency.relation.gate === 'hard'
    ? `hard · нужно: ${labelOf(dependency.requiredCode)} · ${dependency.satisfied ? 'gate открыт' : 'блокирует'}`
    : 'soft dependency';
  return `<button class="relation-item ${blocking ? 'is-blocking' : ''}" data-skill="${dependency.item.skill.id}" data-block="${dependency.item.skill.block}">
    <span class="relation-copy"><strong>${blocking ? '🔒 ' : ''}${dependency.item.skill.title}</strong><small>${meta}</small></span>
    ${status(dependency.item)}
  </button>`;
}

function relationHtml(item) {
  return `<button class="relation-item" data-skill="${item.skill.id}" data-block="${item.skill.block}"><strong>${item.skill.title}</strong>${status(item)}</button>`;
}

function nextEvidenceFor(item) {
  if (item.entry?.active_issue?.type === 'misconception') {
    return 'Нужно самостоятельно объяснить исправленную причинную модель и применить её на новом примере.';
  }
  if (item.entry?.active_issue?.type === 'gap') {
    return 'Нужно закрыть недостающий фрагмент и затем продемонстрировать его без существенной подсказки.';
  }
  if (item.minStatus === 'needs_confirmation') {
    return 'Transfer Check: новая формулировка или другой сюжет с тем же скрытым принципом, без подсказки на механизм.';
  }
  return nextEvidence(item.skill.min);
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
  if (filter === 'review') {
    const state = reviewState(item);
    return state === 'due' || state === 'overdue';
  }
  if (filter === 'min') return item.minStatus === 'min_met' && !item.targetMet;
  if (filter === 'target') return item.targetMet;
  return true;
}

function experienceStatusMeta(code) {
  if (code === 'retained') return ['Закреплено', 'target'];
  if (code === 'demonstrated') return ['Продемонстрировано', 'min'];
  if (code === 'learning') return ['В изучении', 'confirm'];
  return ['Не проверено', 'gap'];
}

function experienceStatus(code) {
  const [label, cls] = experienceStatusMeta(code);
  return `<span class="status ${cls}">${label}</span>`;
}

function experienceHtml() {
  const projects = experienceData?.projects ?? [];
  if (!projects.length) return '';

  const projectsHtml = projects.map(project => {
    const items = project.items ?? [];
    const demonstrated = items.filter(item => ['demonstrated', 'retained'].includes(item.status)).length;
    const retained = items.filter(item => item.status === 'retained').length;
    const rows = items.map(item => `
      <article class="experience-item">
        <div class="experience-main">
          <div class="experience-title"><strong>${item.title}</strong>${experienceStatus(item.status)}</div>
          <p>${item.summary ?? ''}</p>
          <div class="experience-target"><span class="label">Практический таргет</span><p>${item.target ?? ''}</p></div>
        </div>
        ${item.source_ref ? `<a class="experience-link" href="${privateRepoBase}${item.source_ref}" target="_blank" rel="noreferrer">source</a>` : ''}
      </article>`).join('');

    return `<article class="experience-project">
      <div class="experience-project-head">
        <div><span class="eyebrow">${project.company ?? 'Experience'}</span><h3>${project.title}</h3><p>${project.description ?? ''}</p></div>
        <div class="experience-counters"><span>demonstrated <b>${demonstrated}/${items.length}</b></span><span>retained <b>${retained}/${items.length}</b></span></div>
      </div>
      <div class="experience-list">${rows}</div>
    </article>`;
  }).join('');

  return `<section class="section card experience-section" style="padding:24px">
    <div class="section-head"><div><span class="eyebrow">Experience readiness</span><h2 class="section-title">Заявляемый опыт → реальные навыки</h2></div><p>Все точки начинаются с «Не проверено». Статус меняется только после практической проверки.</p></div>
    <div class="experience-projects">${projectsHtml}</div>
  </section>`;
}

function tabsHtml() {
  return tabs.map(tab => `<button data-priority="${tab}" class="${priority === tab ? 'active' : ''}">${tab === 'experience' ? 'Кейсы из опыта' : tab}</button>`).join('');
}

function bindTabs() {
  app.querySelectorAll('[data-priority]').forEach(btn => btn.addEventListener('click', () => {
    priority = btn.dataset.priority;
    selectedBlockId = null;
    selectedSkillId = null;
    filter = 'all';
    render();
  }));
}

function render() {
  if (priority === 'experience') {
    app.innerHTML = `
      <header class="hero"><div><span class="eyebrow">Практика · заявляемый опыт</span><h1>Кейсы из опыта</h1><p>Проверяем задачи из рассказов о проектах самостоятельной практикой. Эти статусы не входят в расчёт P0 и P1.</p><div class="filters" style="justify-content:flex-start;margin-top:14px">${tabsHtml()}</div></div><div class="updated">Данные: ${experienceData.updated_at}</div></header>
      ${experienceHtml()}
      <footer>Практические таргеты связаны с roadmap, но подтверждаются отдельно. Подробные задания хранятся в private learning repository.</footer>`;
    bindTabs();
    return;
  }
  ensureSelection();

  const items = scopedItems();
  const blocks = scopedBlocks();
  const gaps = gapItems(items);
  const studyQueue = studyItems(items);
  const selectedBlock = blockById.get(selectedBlockId) ?? blocks[0];
  const suggested = studyQueue[0] ?? gaps[0] ?? items[0];
  const selected = byId.get(selectedSkillId) ?? suggested;
  const selectedDependencies = selected ? dependenciesOf(selected) : [];
  const selectedUnlocks = selected ? unlocksOf(selected) : [];
  const selectedHardBlockers = selected ? hardBlockersOf(selected) : [];
  const today = localTodayIso();

  if (!selectedBlock || !selected || !suggested) {
    app.innerHTML = '<p class="loading">Для выбранного приоритета пока нет навыков.</p>';
    return;
  }

  const required = items.filter(x => x.skill.min != null);
  const minMet = required.filter(x => x.targetMet || x.minStatus === 'min_met').length;
  const targetMet = items.filter(x => x.targetMet).length;
  const needsConfirmation = required.filter(x => x.minStatus === 'needs_confirmation').length;
  const selectedBlockItems = items.filter(x => x.skill.block === selectedBlock.id);
  const dueReviewCount = selectedBlockItems.filter(item => {
    const state = reviewState(item, today);
    return state === 'due' || state === 'overdue';
  }).length;

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
        <span class="skill-title"><strong>${isLocked(item) ? '<span class="skill-lock" title="Навык заблокирован hard prerequisite" aria-label="Заблокирован">🔒</span>' : ''}${item.skill.title}</strong><span>${item.skill.description}</span></span>
        <span class="current">${labelOf(item.current)}</span>${status(item)}
      </button>`).join('')}</div></section>`;
  }).join('');

  const dependenciesHtml = selectedDependencies.length
    ? `<div class="relation-list">${selectedDependencies.map(dependencyRelationHtml).join('')}</div>`
    : '<p class="relation-empty">Прямые prerequisites не заданы.</p>';
  const unlocksHtml = selectedUnlocks.length
    ? `<div class="relation-list">${selectedUnlocks.map(relationHtml).join('')}</div>`
    : '<p class="relation-empty">Прямых downstream-навыков пока не размечено.</p>';

  const reviewHtml = selected.entry?.review
    ? `<div class="detail-section review-section review-${reviewState(selected, today)}">
        <span class="label">Повторение</span>
        <div class="review-heading">
          <strong>${reviewStatusText(selected, today)}</strong>
          <span>${formatReviewDate(selected.entry.review.next_at)}</span>
        </div>
        <p>Последнее: ${formatReviewDate(selected.entry.review.last_at)} · интервал: ${selected.entry.review.interval_days} дн.</p>
      </div>`
    : `<div class="detail-section review-section review-none">
        <span class="label">Повторение</span>
        <p>Не назначено. Появится после следующей содержательной проверки этого skill.</p>
      </div>`;
  const activeIssueHtml = selected.entry?.active_issue
    ? `<div class="detail-section active-issue">
        <span class="label">Активное слабое место</span>
        <div class="issue-heading">
          <span class="issue-type issue-${selected.entry.active_issue.type}">${selected.entry.active_issue.type}</span>
          <small>${selected.entry.active_issue.observed_at ?? ''}</small>
        </div>
        <p>${selected.entry.active_issue.summary ?? ''}</p>
        ${selected.entry.active_issue.source_ref ? `<a class="issue-source" href="${privateRepoBase}${selected.entry.active_issue.source_ref}" target="_blank" rel="noreferrer">source</a>` : ''}
      </div>`
    : '';

  const ev = selected.entry?.evidence?.length
    ? `<ul class="evidence">${selected.entry.evidence.map(e => `<li><a href="${privateRepoBase}${e.ref}" target="_blank" rel="noreferrer">${e.ref}</a><small>${e.type ?? 'evidence'}${e.date ? ` · ${e.date}` : ''}</small></li>`).join('')}</ul>`
    : '<p>Подтверждающих записей пока нет.</p>';

  const nextHtml = gaps.slice(0, 8).map((item, i) => `<button class="next-item" data-skill="${item.skill.id}" data-block="${item.skill.block}">
    <span class="idx">${String(i + 1).padStart(2, '0')}</span><span class="next-main"><strong>${item.skill.title}</strong><small>${blockById.get(item.skill.block)?.title ?? ''}</small></span>
    <span class="next-level">${labelOf(item.current)} → ${labelOf(item.skill.min)}</span>${status(item)}</button>`).join('');

  const scopeLabel = priorityMeta.get(priority)?.label ?? priority;
  const scopeDescription = priority === 'P0'
    ? 'Обязательный слой: сначала закрываем MIN по базовым навыкам Go backend middle.'
    : 'Следующий слой interview readiness: углубляем production-темы, не смешивая их с P0 readiness.';

  app.innerHTML = `
    <header class="hero"><div><span class="eyebrow">${priority} · ${scopeLabel} · ${catalog.objective}</span><h1>Go Middle Readiness</h1><p>${scopeDescription}</p><div class="filters" style="justify-content:flex-start;margin-top:14px">${tabsHtml()}</div></div><div class="updated">Данные: ${progress.updated_at}</div></header>
    <section class="metrics">
      <article class="metric primary"><div class="metric-row"><span class="eyebrow">${priority} MINIMUM</span><strong>${pct(minMet, required.length)}%</strong></div>${bar(pct(minMet, required.length))}<p><b>${minMet}</b> из <b>${required.length}</b> обязательных MIN подтверждены</p></article>
      <article class="metric"><span class="eyebrow">TARGET coverage</span><strong class="big">${targetMet}/${items.length}</strong><p>${pct(targetMet, items.length)}% навыков дошли до целевого уровня</p></article>
      <article class="metric"><span class="eyebrow">Открытые MIN</span><strong class="big">${required.length - minMet}</strong><p>из них ${needsConfirmation} требуют короткого подтверждения</p></article>
    </section>
    <section class="focus"><div><span class="eyebrow">Следующий учебный шаг · ${priority}</span><h2>${suggested.skill.title}</h2><p>${suggested.skill.description}</p></div>${levelPath(suggested)}<div class="focus-next"><span class="label">Почему сейчас</span><strong>${studyPriorityReason(suggested, items, today)}</strong></div></section>
    <section class="section card" style="padding:24px"><div class="section-head"><div><span class="eyebrow">${priority} blocks</span><h2 class="section-title">Карта готовности</h2></div><p>Приоритеты считаются отдельно: P1 не снижает P0 readiness.</p></div><div class="blocks">${blocksHtml}</div></section>
    <section class="layout section">
      <div class="panel"><div class="toolbar"><div><span class="eyebrow">Roadmap · ${priority}</span><h2 class="section-title">${selectedBlock.title}</h2></div><div class="filters">${[['all','Все'],['gaps','Ниже MIN'],['confirm','Подтвердить'],['review', dueReviewCount ? `Повторить · ${dueReviewCount}` : 'Повторить'],['min','MIN'],['target','TARGET']].map(([v,t]) => `<button data-filter="${v}" class="${filter === v ? 'active' : ''}">${t}</button>`).join('')}</div></div>${groupsHtml || '<p style="color:var(--muted)">В этом фильтре навыков нет.</p>'}</div>
      <aside class="detail">${status(selected)}<h2>${selected.skill.title}</h2><p>${selected.skill.description}</p>${levelPath(selected)}
        <div class="detail-section detail-next-step"><span class="label">Следующий шаг</span><p>${nextStep(selected, selectedHardBlockers)}</p></div>
        ${reviewHtml}
        ${activeIssueHtml}
        <div class="detail-section"><span class="label">Опирается на</span>${dependenciesHtml}</div>
        <div class="detail-section"><span class="label">Разблокирует</span>${unlocksHtml}</div>
        <div class="detail-section"><span class="label">Следующее evidence</span><p>${nextEvidenceFor(selected)}</p></div>
        ${selected.entry?.note ? `<div class="detail-section"><span class="label">Почему CURRENT такой</span><p>${selected.entry.note}</p></div>` : ''}
        <div class="detail-section"><span class="label">Evidence</span>${ev}</div>
      </aside>
    </section>
    <section class="section card" style="padding:24px"><div class="section-head"><div><span class="eyebrow">Next · ${priority}</span><h2 class="section-title">Ближайшие gaps</h2></div><p>Review и misconceptions выше prerequisites; затем Transfer Check и обычные gaps. Близость к MIN — только tie-break.</p></div><div class="next-list">${nextHtml || '<p style="color:var(--muted)">Все обязательные MIN этого слоя закрыты.</p>'}</div></section>
    <footer>Публичная read-only визуализация. Source of truth остаётся в private learning repository; P0 и P1 считаются независимо из опубликованных YAML.</footer>`;

  bindTabs();
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
