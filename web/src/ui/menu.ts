// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Menu principal (2026-08-25, demande utilisateur : « ouvrir le site sur la
 * meme URL a chaque fois »). Affiche quand l'URL n'a PAS de ?project= :
 * l'utilisateur bookmarke la racine (localhost:5173/ + #stoken epingle) et
 * choisit / cree un projet ici. Ouvrir un projet = naviguer vers
 * ?project=<id> en PRESERVANT le fragment (#token/#stoken) - le token moteur
 * s'auto-recupere de toute facon (vite /api/engine-token).
 *
 * Ecran autonome, monte AVANT l'app (main.ts) : il n'a besoin ni du moteur
 * ni du document, seulement de la liste des projets (/api/projects, dev).
 */

interface ProjectRow {
  id: string;
  mtime: number;
}

const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Navigue vers un projet en gardant le fragment (tokens) intact. */
function openProject(id: string): void {
  window.location.href = `/?project=${encodeURIComponent(id)}${window.location.hash}`;
}

function timeAgo(mtimeMs: number): string {
  if (!mtimeMs) return '';
  const s = Math.max(0, (Date.now() - mtimeMs) / 1000);
  if (s < 90) return "a l'instant";
  const m = s / 60;
  if (m < 90) return `il y a ${Math.round(m)} min`;
  const h = m / 60;
  if (h < 36) return `il y a ${Math.round(h)} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

// Les tests e2e creent des projets jetables nommes `<truc>-<timestamp 13
// chiffres>` ; on les MASQUE du menu (le store en est plein). Les projets
// nommes a la main (studio, song...) n'ont pas ce suffixe.
// RENFORCE 2026-08-27 (incident utilisateur : le menu l'a envoye sur
// `trace-kinds-433956`, un artefact de capture a suffixe COURT qui
// passait le filtre) : les PREFIXES de harnais sont masques aussi,
// quel que soit le suffixe. Toute spec/trace DOIT nommer ses projets
// e2e-*/trace-*/crit3-* ou avec un timestamp - jamais un nom nu.
const TEST_ARTIFACT = /(?:-\d{10,}$)|(?:^(?:e2e|trace|crit3)-)/;

async function fetchProjects(): Promise<ProjectRow[]> {
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) return [];
    const data = (await res.json()) as { projects?: ProjectRow[] };
    return (data.projects ?? []).filter((p) => !TEST_ARTIFACT.test(p.id));
  } catch {
    return [];
  }
}

export async function mountMenu(root: HTMLElement): Promise<void> {
  const projects = await fetchProjects();

  const overlay = document.createElement('div');
  overlay.className = 'menu';
  overlay.id = 'menu';

  const card = document.createElement('div');
  card.className = 'menu-card';

  const brand = document.createElement('div');
  brand.className = 'menu-brand';
  brand.innerHTML = '<span class="menu-mark">MAGIC</span> POTION';
  const tagline = document.createElement('div');
  tagline.className = 'menu-tagline';
  tagline.textContent = 'Choisis un projet, ou commence-en un nouveau.';
  card.append(brand, tagline);

  // ---- Liste des projets ----
  const listWrap = document.createElement('div');
  listWrap.className = 'menu-list';
  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'menu-empty';
    empty.textContent = 'Aucun projet pour le moment — cree le premier ci-dessous.';
    listWrap.appendChild(empty);
  }
  for (const p of projects) {
    const row = document.createElement('button');
    row.className = 'menu-project';
    row.dataset.role = 'open-project';
    row.dataset.projectId = p.id;
    const name = document.createElement('span');
    name.className = 'menu-project-name';
    name.textContent = p.id;
    const meta = document.createElement('span');
    meta.className = 'menu-project-meta';
    meta.textContent = timeAgo(p.mtime);
    const go = document.createElement('span');
    go.className = 'menu-project-go';
    go.textContent = '→';  // fleche
    row.append(name, meta, go);
    row.addEventListener('click', () => openProject(p.id));
    listWrap.appendChild(row);
  }
  card.appendChild(listWrap);

  // ---- Nouveau projet ----
  const form = document.createElement('form');
  form.className = 'menu-new';
  const input = document.createElement('input');
  input.className = 'menu-new-input';
  input.type = 'text';
  input.placeholder = 'nom du nouveau projet';
  input.setAttribute('aria-label', 'Nom du nouveau projet');
  input.dataset.role = 'new-project-name';
  const create = document.createElement('button');
  create.className = 'menu-new-btn';
  create.type = 'submit';
  create.dataset.role = 'create-project';
  create.textContent = '+ Creer';
  const err = document.createElement('div');
  err.className = 'menu-new-err';
  err.setAttribute('aria-live', 'polite');

  const submit = (e: Event): void => {
    e.preventDefault();
    const id = input.value.trim();
    if (!VALID_ID.test(id)) {
      err.textContent = 'Nom invalide : lettres, chiffres, - et _ (max 64).';
      input.classList.add('invalid');
      return;
    }
    if (projects.some((p) => p.id === id)) {
      // existe deja : on l'ouvre simplement (pas d'ecrasement)
      openProject(id);
      return;
    }
    openProject(id);  // le serveur cree le projet (seed) au premier sync
  };
  form.addEventListener('submit', submit);
  input.addEventListener('input', () => { input.classList.remove('invalid'); err.textContent = ''; });
  form.append(input, create);
  card.append(form, err);

  const hint = document.createElement('div');
  hint.className = 'menu-hint';
  hint.textContent = 'Astuce : bookmarke cette page — elle t’ouvre toujours ce menu.';
  card.appendChild(hint);

  overlay.appendChild(card);
  root.appendChild(overlay);
  input.focus();
}
