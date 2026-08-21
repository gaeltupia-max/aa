/* =========================================================
   AEGIS LEAGUE — main.js
   CMS en tiempo real con persistencia en Firebase Firestore.
   ========================================================= */

import { db, auth, ADMIN_EMAIL } from "./firebase-init.js";
import {
  doc, getDoc, setDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

(function () {
  "use strict";

  // Documento único donde vive todo el estado del torneo
  const TOURNAMENT_DOC = doc(db, "torneo", "aegis-league");

  /* ---------------------------------------------------------
     1. MOCK DATA — 20 equipos ficticios + partidas de ejemplo
     (se usa solo la PRIMERA vez, si el documento no existe aún)
  --------------------------------------------------------- */
  const TEAM_NAMES = [
    "Team Radiant", "Dire Wolves", "Ancient Guardians", "Phantom Reapers",
    "Aegis Hunters", "Roshan Riders", "Spectral Vanguard", "Fnatic Ashes",
    "Iron Creeps", "Void Spirits", "Crimson Wyrms", "Storm Callers",
    "Rune Breakers", "Shadow Fiends", "Aegis Titans", "Techies United",
    "Divine Wardens", "Immortal Legion", "Nyx Assassins", "Cinder Squad"
  ];

  function buildMockData() {
    const groups = ["A", "B", "C", "D"];
    const teams = TEAM_NAMES.map((name, i) => ({
      id: i + 1,
      name: name,
      logo: `assets/images/teams/team${i + 1}.png`,
      status: "active",
      group: groups[Math.floor(i / 5)]
    }));

    const matches = [];
    let mCounter = 1;
    const nextId = () => `m${mCounter++}`;

    groups.forEach((g) => {
      const groupTeams = teams.filter((t) => t.group === g);
      matches.push({
        id: nextId(), round: "Grupos", teamA_id: groupTeams[0].id, teamB_id: groupTeams[1].id,
        scoreA: 1, scoreB: 0, format: "Bo1", winner_id: groupTeams[0].id
      });
      matches.push({
        id: nextId(), round: "Grupos", teamA_id: groupTeams[2].id, teamB_id: groupTeams[3].id,
        scoreA: 0, scoreB: 0, format: "Bo1", winner_id: null
      });
    });

    matches.filter(m => m.winner_id).forEach(m => {
      const loserId = m.winner_id === m.teamA_id ? m.teamB_id : m.teamA_id;
      const winner = teams.find(t => t.id === m.winner_id);
      const loser = teams.find(t => t.id === loserId);
      if (winner) winner.status = "clasificado";
      if (loser) loser.status = "eliminado";
    });

    matches.push({ id: nextId(), round: "Cuartos", teamA_id: 1, teamB_id: 6, scoreA: 1, scoreB: 0, format: "Bo1", winner_id: 1 });
    matches.push({ id: nextId(), round: "Cuartos", teamA_id: 11, teamB_id: 16, scoreA: 0, scoreB: 1, format: "Bo1", winner_id: 16 });
    matches.push({ id: nextId(), round: "Cuartos", teamA_id: null, teamB_id: null, scoreA: 0, scoreB: 0, format: "Bo1", winner_id: null });
    matches.push({ id: nextId(), round: "Cuartos", teamA_id: null, teamB_id: null, scoreA: 0, scoreB: 0, format: "Bo1", winner_id: null });

    teams.find(t => t.id === 1).status = "clasificado";
    teams.find(t => t.id === 6).status = "eliminado";
    teams.find(t => t.id === 16).status = "clasificado";
    teams.find(t => t.id === 11).status = "eliminado";

    matches.push({ id: nextId(), round: "Semifinal", teamA_id: null, teamB_id: null, scoreA: 0, scoreB: 0, format: "Bo3", winner_id: null });
    matches.push({ id: nextId(), round: "Semifinal", teamA_id: null, teamB_id: null, scoreA: 0, scoreB: 0, format: "Bo3", winner_id: null });
    matches.push({ id: nextId(), round: "Final", teamA_id: null, teamB_id: null, scoreA: 0, scoreB: 0, format: "Bo3", winner_id: null });

    return { teams, matches };
  }

  /* ---------------------------------------------------------
     2. ESTADO GLOBAL — carga / guardado en FIRESTORE
     (esto reemplaza el localStorage de la versión anterior)
  --------------------------------------------------------- */
  let state = null;
  let suppressNextSnapshotRender = false;

  // Carga inicial + escucha de cambios en tiempo real desde CUALQUIER dispositivo
  async function initState() {
    const snap = await getDoc(TOURNAMENT_DOC);
    if (snap.exists()) {
      state = snap.data();
    } else {
      state = buildMockData();
      await setDoc(TOURNAMENT_DOC, state);
    }
    renderAll();

    // Cada vez que CUALQUIER admin (en cualquier computadora) guarda un cambio,
    // Firestore avisa a todos los navegadores abiertos y se vuelve a pintar la página.
    onSnapshot(TOURNAMENT_DOC, (docSnap) => {
      if (!docSnap.exists()) return;
      state = docSnap.data();
      renderAll();
    });
  }

  async function saveState() {
    try {
      await setDoc(TOURNAMENT_DOC, state);
    } catch (e) {
      console.error("Error al guardar en Firestore:", e);
      alert("No se pudo guardar el cambio. Revisa tu conexión a internet o que hayas iniciado sesión como admin.");
    }
  }

  // Guardado con espera breve (para los marcadores, mientras el admin escribe números)
  let saveScoreTimeout = null;
  function saveStateDebounced() {
    clearTimeout(saveScoreTimeout);
    saveScoreTimeout = setTimeout(saveState, 500);
  }

  function getTeamById(id) {
    if (id === null || id === undefined) return null;
    return state.teams.find((t) => t.id === id) || null;
  }

  /* ---------------------------------------------------------
     3. UTILIDADES
  --------------------------------------------------------- */
  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
  }

  function initials(name) {
    return String(name || "?")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  }

  function statusLabel(status) {
    switch (status) {
      case "clasificado": return "Clasificado";
      case "eliminado": return "Eliminado";
      case "campeon": return "Campeón";
      default: return "En Competencia";
    }
  }

  function statusBadgeClass(status) {
    switch (status) {
      case "clasificado": return "badge-clasificado";
      case "eliminado": return "badge-eliminado";
      case "campeon": return "badge-campeon";
      default: return "badge-active";
    }
  }

  function roundLabel(round) {
    const map = { Grupos: "Fase de Grupos", Cuartos: "Cuartos de Final", Semifinal: "Semifinales", Final: "Gran Final" };
    return map[round] || round;
  }

  /* ---------------------------------------------------------
     4. LOGO / AVATAR CON FALLBACK
  --------------------------------------------------------- */
  function teamAvatarHTML(team, sizeClass) {
    const safeName = escapeHTML(team ? team.name : "Equipo Eliminado");
    const initialsText = initials(team ? team.name : "NA");
    const logoPath = team ? escapeHTML(team.logo) : "";
    return `
      <div class="relative ${sizeClass} shrink-0">
        <img src="${logoPath}" alt="${safeName}" loading="lazy"
             class="team-logo-img ${sizeClass} rounded-lg object-cover hidden"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="team-logo-fallback ${sizeClass} rounded-lg bg-gradient-to-br from-panel to-black/40 border border-white/10 flex items-center justify-center font-display font-bold text-gray-300"
             style="display:flex;">${initialsText}</div>
      </div>`;
  }

  document.addEventListener(
    "error",
    function (e) {
      const el = e.target;
      if (el && el.tagName === "IMG" && el.classList.contains("team-logo-img")) {
        el.style.display = "none";
        if (el.nextElementSibling) el.nextElementSibling.style.display = "flex";
      }
    },
    true
  );

  /* ---------------------------------------------------------
     5. RENDER: HEADER LOGO
  --------------------------------------------------------- */
  function initHeaderLogo() {
    const img = document.getElementById("logo-header");
    const fallback = document.getElementById("logo-header-fallback");
    if (!img || !fallback) return;
    img.addEventListener("error", () => {
      img.classList.add("hidden");
      fallback.classList.remove("hidden");
    });
    img.addEventListener("load", () => {
      img.classList.remove("hidden");
      fallback.classList.add("hidden");
    });
  }

  /* ---------------------------------------------------------
     6. RENDER: GRID DE EQUIPOS (público)
  --------------------------------------------------------- */
  function renderTeamsGrid() {
    const grid = document.getElementById("teams-grid");
    if (!grid) return;
    if (!state.teams.length) {
      grid.innerHTML = `<p class="col-span-full text-center text-gray-500 py-10">Aún no hay equipos registrados.</p>`;
      return;
    }
    grid.innerHTML = state.teams
      .map(
        (team) => `
      <div class="glass rounded-xl p-4 text-center hover:shadow-glow-gold transition group">
        <div class="flex justify-center mb-3">${teamAvatarHTML(team, "h-16 w-16")}</div>
        <p class="font-display text-sm font-semibold text-white truncate" title="${escapeHTML(team.name)}">${escapeHTML(team.name)}</p>
        <p class="text-xs text-gray-500 mt-1">Grupo ${escapeHTML(team.group)}</p>
        <span class="inline-block mt-3 text-[10px] font-display uppercase tracking-wider px-3 py-1 rounded-full ${statusBadgeClass(team.status)}">
          ${statusLabel(team.status)}
        </span>
      </div>`
      )
      .join("");

    const statTeams = document.getElementById("stat-teams");
    if (statTeams) statTeams.textContent = state.teams.length;
    const statMatches = document.getElementById("stat-matches");
    if (statMatches) statMatches.textContent = state.matches.length;
  }

  /* ---------------------------------------------------------
     7. RENDER: BRACKETS (público)
  --------------------------------------------------------- */
  const ROUND_ORDER = ["Grupos", "Cuartos", "Semifinal", "Final"];

  function matchCardHTML(match) {
    const teamA = getTeamById(match.teamA_id);
    const teamB = getTeamById(match.teamB_id);
    const hasWinner = !!match.winner_id;
    const aIsWinner = hasWinner && match.winner_id === match.teamA_id;
    const bIsWinner = hasWinner && match.winner_id === match.teamB_id;

    function rowHTML(team, score, isWinner) {
      const nameText = team ? escapeHTML(team.name) : "Por definir";
      const nameClass = team ? "text-gray-200" : "text-gray-600 italic";
      return `
        <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md ${isWinner ? "bg-radiant/10 border border-radiant/30" : ""}">
          <div class="flex items-center gap-2 min-w-0">
            ${team ? teamAvatarHTML(team, "h-6 w-6") : `<div class="h-6 w-6 rounded bg-black/30 border border-white/10 shrink-0"></div>`}
            <span class="text-sm truncate ${nameClass}">${nameText}</span>
            ${isWinner ? '<i class="fa-solid fa-crown text-radiant text-xs"></i>' : ""}
          </div>
          <span class="font-display font-bold text-sm ${isWinner ? "text-radiant" : "text-gray-400"}">${score}</span>
        </div>`;
    }

    return `
      <div class="bracket-match glass rounded-lg w-64 shrink-0 overflow-hidden">
        <div class="flex items-center justify-between px-3 py-1.5 bg-black/30 text-[10px] uppercase tracking-wider text-gray-500">
          <span>${escapeHTML(match.format)}</span>
          <span>${match.winner_id ? "Finalizado" : "Pendiente"}</span>
        </div>
        <div class="py-2 px-1 space-y-1">
          ${rowHTML(teamA, match.scoreA, aIsWinner)}
          ${rowHTML(teamB, match.scoreB, bIsWinner)}
        </div>
      </div>`;
  }

  function renderBrackets() {
    const container = document.getElementById("brackets-flex");
    if (!container) return;

    container.innerHTML = ROUND_ORDER.map((round) => {
      const roundMatches = state.matches.filter((m) => m.round === round);
      const cards = roundMatches.length
        ? roundMatches.map(matchCardHTML).join("")
        : `<p class="text-gray-600 text-sm italic">Sin partidas aún</p>`;
      return `
        <div class="bracket-col flex flex-col gap-6 justify-center">
          <h3 class="font-display text-xs uppercase tracking-widest text-center text-spectral mb-1">${roundLabel(round)}</h3>
          <div class="flex flex-col gap-6">${cards}</div>
        </div>`;
    }).join("");
  }

  /* ---------------------------------------------------------
     8. ADMIN: LOGIN GATE (ahora con Firebase Authentication)
  --------------------------------------------------------- */
  function initAdminGate() {
    const gate = document.getElementById("admin-login-gate");
    const panel = document.getElementById("admin-panel");
    const form = document.getElementById("admin-login-form");
    const passwordInput = document.getElementById("admin-password");
    const errorMsg = document.getElementById("admin-login-error");
    const logoutBtn = document.getElementById("btn-admin-logout");
    if (!gate || !panel || !form) return;

    function showPanel() {
      gate.classList.add("hidden");
      panel.classList.remove("hidden");
      renderAdminTeamsTable();
      renderAdminMatchesList();
      populateMatchTeamSelects();
    }

    function showGate() {
      panel.classList.add("hidden");
      gate.classList.remove("hidden");
    }

    // Firebase avisa automáticamente si ya hay una sesión activa (persiste entre visitas)
    onAuthStateChanged(auth, (user) => {
      if (user) {
        showPanel();
      } else {
        showGate();
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorMsg.classList.add("hidden");
      signInWithEmailAndPassword(auth, ADMIN_EMAIL, passwordInput.value)
        .then(() => {
          passwordInput.value = "";
        })
        .catch((err) => {
          console.error(err);
          errorMsg.textContent = "Clave incorrecta o error de conexión. Intenta nuevamente.";
          errorMsg.classList.remove("hidden");
        });
    });

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        signOut(auth);
      });
    }
  }

  /* ---------------------------------------------------------
     9. ADMIN: GESTIÓN DE EQUIPOS
  --------------------------------------------------------- */
  function renderAdminTeamsTable() {
    const tbody = document.getElementById("admin-teams-table");
    if (!tbody) return;
    if (!state.teams.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-gray-500">No hay equipos registrados.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.teams
      .map(
        (team) => `
      <tr class="border-b border-white/5">
        <td class="py-3 pr-4">
          <div class="flex items-center gap-3">
            ${teamAvatarHTML(team, "h-8 w-8")}
            <span class="text-white font-medium">${escapeHTML(team.name)}</span>
          </div>
        </td>
        <td class="py-3 pr-4 text-gray-400">Grupo ${escapeHTML(team.group)}</td>
        <td class="py-3 pr-4">
          <span class="text-[10px] font-display uppercase tracking-wider px-2.5 py-1 rounded-full ${statusBadgeClass(team.status)}">${statusLabel(team.status)}</span>
        </td>
        <td class="py-3 pr-4">
          <div class="flex justify-end gap-2">
            <button data-action="edit-team" data-id="${team.id}" class="text-xs px-3 py-1.5 rounded-md border border-spectral/40 text-spectral hover:bg-spectral hover:text-carbon transition">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button data-action="disqualify-team" data-id="${team.id}" class="text-xs px-3 py-1.5 rounded-md border border-radiant/40 text-radiant hover:bg-radiant hover:text-carbon transition" title="Descalificar">
              <i class="fa-solid fa-ban"></i>
            </button>
            <button data-action="delete-team" data-id="${team.id}" class="text-xs px-3 py-1.5 rounded-md border border-fire/40 text-fire hover:bg-fire hover:text-white transition" title="Eliminar">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>`
      )
      .join("");
  }

  function initTeamForm() {
    const form = document.getElementById("team-form");
    const nameInput = document.getElementById("team-name-input");
    const logoFileInput = document.getElementById("team-logo-file");
    const logoDataInput = document.getElementById("team-logo-data");
    const logoFileLabel = document.getElementById("team-logo-file-label");
    const logoPreview = document.getElementById("team-logo-preview");
    const groupInput = document.getElementById("team-group-input");
    const editingIdInput = document.getElementById("team-editing-id");
    const submitBtn = document.getElementById("team-submit-btn");
    const errorEl = document.getElementById("team-form-error");
    if (!form) return;

    const MAX_LOGO_BYTES = 500 * 1024;

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove("hidden");
    }
    function clearError() {
      errorEl.classList.add("hidden");
      errorEl.textContent = "";
    }
    function setPreview(dataUrl) {
      if (dataUrl) {
        logoPreview.src = dataUrl;
        logoPreview.classList.remove("hidden");
      } else {
        logoPreview.src = "";
        logoPreview.classList.add("hidden");
      }
    }
    function resetForm() {
      form.reset();
      editingIdInput.value = "";
      logoDataInput.value = "";
      logoFileLabel.textContent = "Subir logo del equipo";
      setPreview("");
      submitBtn.innerHTML = '<i class="fa-solid fa-plus mr-1"></i> Agregar Equipo';
      clearError();
    }

    logoFileInput.addEventListener("change", () => {
      const file = logoFileInput.files && logoFileInput.files[0];
      if (!file) return;
      clearError();

      if (!file.type.startsWith("image/")) {
        showError("El archivo seleccionado debe ser una imagen.");
        logoFileInput.value = "";
        return;
      }
      if (file.size > MAX_LOGO_BYTES) {
        showError("La imagen es muy pesada (máx. 500KB). Elige una más liviana — Firestore también tiene límite de tamaño por documento.");
        logoFileInput.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        logoDataInput.value = String(reader.result);
        logoFileLabel.textContent = file.name;
        setPreview(String(reader.result));
      };
      reader.onerror = () => {
        showError("No se pudo leer la imagen seleccionada.");
      };
      reader.readAsDataURL(file);
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      clearError();
      const name = nameInput.value.trim();
      const logo = logoDataInput.value || `assets/images/teams/placeholder.png`;
      const group = groupInput.value;
      const editingId = editingIdInput.value ? Number(editingIdInput.value) : null;

      if (!name) {
        showError("El nombre del equipo es obligatorio.");
        return;
      }

      const duplicate = state.teams.find(
        (t) => t.name.trim().toLowerCase() === name.toLowerCase() && t.id !== editingId
      );
      if (duplicate) {
        showError("Ya existe un equipo registrado con ese nombre.");
        return;
      }

      if (editingId) {
        const team = getTeamById(editingId);
        if (team) {
          team.name = name;
          team.logo = logo;
          team.group = group;
        }
      } else {
        const newId = state.teams.length ? Math.max(...state.teams.map((t) => t.id)) + 1 : 1;
        state.teams.push({ id: newId, name, logo, status: "active", group });
      }

      saveState();
      resetForm();
      renderAll();
    });

    document.getElementById("admin-teams-table").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const action = btn.dataset.action;
      const team = getTeamById(id);
      if (!team) return;

      if (action === "edit-team") {
        editingIdInput.value = String(team.id);
        nameInput.value = team.name;
        groupInput.value = team.group;
        logoDataInput.value = team.logo && team.logo.startsWith("data:") ? team.logo : "";
        logoFileLabel.textContent = "Subir logo del equipo";
        setPreview(team.logo && team.logo.startsWith("data:") ? team.logo : "");
        submitBtn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Guardar Cambios';
        nameInput.focus();
        window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" });
      }

      if (action === "disqualify-team") {
        if (confirm(`¿Descalificar a "${team.name}"? Su estado cambiará a Eliminado.`)) {
          team.status = "eliminado";
          saveState();
          renderAll();
        }
      }

      if (action === "delete-team") {
        if (confirm(`¿Eliminar definitivamente a "${team.name}"? Esta acción no se puede deshacer.`)) {
          state.teams = state.teams.filter((t) => t.id !== id);
          state.matches.forEach((m) => {
            if (m.teamA_id === id) m.teamA_id = null;
            if (m.teamB_id === id) m.teamB_id = null;
            if (m.winner_id === id) m.winner_id = null;
          });
          saveState();
          if (editingIdInput.value === String(id)) resetForm();
          renderAll();
        }
      }
    });
  }

  /* ---------------------------------------------------------
     10. ADMIN: CREADOR DE ENFRENTAMIENTOS + BRACKET CONTROL
  --------------------------------------------------------- */
  function populateMatchTeamSelects() {
    const selectA = document.getElementById("match-teamA-input");
    const selectB = document.getElementById("match-teamB-input");
    if (!selectA || !selectB) return;

    const activeTeams = state.teams.filter((t) => t.status === "active" || t.status === "clasificado");
    const options = ['<option value="">Equipo A</option>']
      .concat(activeTeams.map((t) => `<option value="${t.id}">${escapeHTML(t.name)}</option>`))
      .join("");
    const optionsB = ['<option value="">Equipo B</option>']
      .concat(activeTeams.map((t) => `<option value="${t.id}">${escapeHTML(t.name)}</option>`))
      .join("");
    selectA.innerHTML = options;
    selectB.innerHTML = optionsB;
  }

  function initMatchForm() {
    const form = document.getElementById("match-form");
    const teamAInput = document.getElementById("match-teamA-input");
    const teamBInput = document.getElementById("match-teamB-input");
    const roundInput = document.getElementById("match-round-input");
    const formatInput = document.getElementById("match-format-input");
    const errorEl = document.getElementById("match-form-error");
    if (!form) return;

    roundInput.addEventListener("change", () => {
      formatInput.value = roundInput.value === "Semifinal" || roundInput.value === "Final" ? "Bo3" : "Bo1";
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorEl.classList.add("hidden");
      const teamA = Number(teamAInput.value);
      const teamB = Number(teamBInput.value);

      if (!teamA || !teamB) {
        errorEl.textContent = "Selecciona ambos equipos.";
        errorEl.classList.remove("hidden");
        return;
      }
      if (teamA === teamB) {
        errorEl.textContent = "Un equipo no puede enfrentarse a sí mismo.";
        errorEl.classList.remove("hidden");
        return;
      }

      const newId = "m" + (state.matches.length ? Math.max(...state.matches.map((m) => parseInt(m.id.replace(/\D/g, ""), 10) || 0)) + 1 : 1);
      state.matches.push({
        id: newId,
        round: roundInput.value,
        teamA_id: teamA,
        teamB_id: teamB,
        scoreA: 0,
        scoreB: 0,
        format: formatInput.value,
        winner_id: null
      });

      saveState();
      form.reset();
      renderAll();
    });
  }

  function renderAdminMatchesList() {
    const list = document.getElementById("admin-matches-list");
    if (!list) return;
    if (!state.matches.length) {
      list.innerHTML = `<p class="text-gray-500 text-sm text-center py-4">No hay partidas creadas.</p>`;
      return;
    }

    list.innerHTML = state.matches
      .map((m) => {
        const teamA = getTeamById(m.teamA_id);
        const teamB = getTeamById(m.teamB_id);
        const finished = !!m.winner_id;
        return `
        <div class="bg-black/25 rounded-xl p-4 border border-white/5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <span class="text-xs font-display uppercase tracking-wider text-spectral">${roundLabel(m.round)} &middot; ${escapeHTML(m.format)}</span>
            <span class="text-xs ${finished ? "text-radiant" : "text-gray-500"}">${finished ? "Finalizada" : "En curso"}</span>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div class="flex items-center gap-2 min-w-0">
              ${teamA ? teamAvatarHTML(teamA, "h-8 w-8") : `<div class="h-8 w-8 rounded bg-black/30 border border-white/10"></div>`}
              <span class="text-sm text-white truncate">${teamA ? escapeHTML(teamA.name) : "Por definir"}</span>
            </div>
            <div class="flex items-center gap-2 justify-center">
              <input type="number" min="0" data-match="${m.id}" data-field="scoreA" value="${m.scoreA}" ${finished ? "disabled" : ""}
                class="w-14 text-center bg-black/40 border border-white/10 rounded-md py-1.5 text-white text-sm focus:border-fire outline-none disabled:opacity-40">
              <span class="text-gray-500">-</span>
              <input type="number" min="0" data-match="${m.id}" data-field="scoreB" value="${m.scoreB}" ${finished ? "disabled" : ""}
                class="w-14 text-center bg-black/40 border border-white/10 rounded-md py-1.5 text-white text-sm focus:border-fire outline-none disabled:opacity-40">
            </div>
            <div class="flex items-center gap-2 min-w-0 sm:justify-end">
              <span class="text-sm text-white truncate">${teamB ? escapeHTML(teamB.name) : "Por definir"}</span>
              ${teamB ? teamAvatarHTML(teamB, "h-8 w-8") : `<div class="h-8 w-8 rounded bg-black/30 border border-white/10"></div>`}
            </div>
          </div>
          <div class="flex items-center justify-between mt-4">
            <span class="text-xs text-gray-500">${finished ? `Ganador: ${escapeHTML(getTeamById(m.winner_id)?.name || "N/A")}` : "Marcador en vivo"}</span>
            <div class="flex gap-2">
              ${!finished ? `<button data-action="declare-winner" data-id="${m.id}" class="text-xs font-display uppercase tracking-wider px-4 py-2 rounded-md bg-fire hover:bg-firelight text-white transition"><i class="fa-solid fa-trophy mr-1"></i> Declarar Ganador</button>` : ""}
              <button data-action="delete-match" data-id="${m.id}" class="text-xs px-3 py-2 rounded-md border border-fire/30 text-fire hover:bg-fire hover:text-white transition"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        </div>`;
      })
      .join("");
  }

  function initMatchesListEvents() {
    const list = document.getElementById("admin-matches-list");
    if (!list) return;

    list.addEventListener("input", (e) => {
      const input = e.target.closest("input[data-match]");
      if (!input) return;
      const match = state.matches.find((m) => m.id === input.dataset.match);
      if (!match) return;
      const value = Math.max(0, parseInt(input.value, 10) || 0);
      match[input.dataset.field] = value;
      saveStateDebounced(); // espera a que dejes de escribir para guardar
      renderBrackets();
    });

    list.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const match = state.matches.find((m) => m.id === btn.dataset.id);
      if (!match) return;

      if (btn.dataset.action === "declare-winner") {
        if (match.scoreA === match.scoreB) {
          alert("No se puede declarar un ganador con marcador empatado. Actualiza el resultado primero.");
          return;
        }
        if (!match.teamA_id || !match.teamB_id) {
          alert("Ambos equipos deben estar definidos antes de declarar un ganador.");
          return;
        }
        const winnerId = match.scoreA > match.scoreB ? match.teamA_id : match.teamB_id;
        const loserId = winnerId === match.teamA_id ? match.teamB_id : match.teamA_id;
        match.winner_id = winnerId;

        const winnerTeam = getTeamById(winnerId);
        const loserTeam = getTeamById(loserId);
        if (loserTeam) loserTeam.status = "eliminado";
        if (winnerTeam) winnerTeam.status = match.round === "Final" ? "campeon" : "clasificado";

        saveState();
        renderAll();
      }

      if (btn.dataset.action === "delete-match") {
        if (confirm("¿Eliminar esta partida del torneo?")) {
          state.matches = state.matches.filter((m) => m.id !== match.id);
          saveState();
          renderAll();
        }
      }
    });
  }

  /* ---------------------------------------------------------
     11. ADMIN: BACKUP (EXPORTAR / IMPORTAR / RESET)
  --------------------------------------------------------- */
  function initBackupSystem() {
    const exportBtn = document.getElementById("btn-export");
    const importInput = document.getElementById("input-import");
    const resetBtn = document.getElementById("btn-reset");
    const statusEl = document.getElementById("backup-status");

    function setStatus(msg, isError) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = "text-xs mt-4 " + (isError ? "text-fire" : "text-green-400");
    }

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        try {
          const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const stamp = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `aegis-league-backup-${stamp}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          setStatus("Copia de seguridad exportada correctamente.", false);
        } catch (err) {
          console.error(err);
          setStatus("Error al exportar los datos.", true);
        }
      });
    }

    if (importInput) {
      importInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(String(reader.result));
            if (!parsed || !Array.isArray(parsed.teams) || !Array.isArray(parsed.matches)) {
              throw new Error("Estructura JSON inválida: se esperaban las claves 'teams' y 'matches'.");
            }
            state = parsed;
            saveState();
            renderAll();
            setStatus(`Datos importados correctamente desde "${file.name}".`, false);
          } catch (err) {
            console.error(err);
            setStatus("El archivo importado no tiene un formato válido.", true);
          } finally {
            importInput.value = "";
          }
        };
        reader.onerror = () => {
          setStatus("No se pudo leer el archivo seleccionado.", true);
          importInput.value = "";
        };
        reader.readAsText(file);
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        if (confirm("¿Restablecer el torneo? Se perderán todos los cambios y se cargarán los datos por defecto.")) {
          state = buildMockData();
          saveState();
          renderAll();
          setStatus("El torneo fue restablecido a los datos por defecto.", false);
        }
      });
    }
  }

  /* ---------------------------------------------------------
     12. RENDER GENERAL
  --------------------------------------------------------- */
  function renderAll() {
    if (!state) return;
    renderTeamsGrid();
    renderBrackets();
    renderAdminTeamsTable();
    renderAdminMatchesList();
    populateMatchTeamSelects();
  }

  /* ---------------------------------------------------------
     13. MATCH FOUND OVERLAY + SONIDO
  --------------------------------------------------------- */
  function initMatchFoundOverlay() {
    const overlay = document.getElementById("match-found-overlay");
    const btn = document.getElementById("btn-accept-match");
    if (!overlay || !btn) return;

    function playSound() {
      try {
        const audio = new Audio("assets/sounds/match-found.mp3");
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((err) => {
            console.warn("Reproducción automática bloqueada por el navegador:", err);
          });
        }
      } catch (err) {
        console.warn("No se pudo reproducir el sonido de partida encontrada:", err);
      }
    }

    btn.addEventListener("click", () => {
      playSound();
      overlay.classList.add("fade-out");
      document.body.style.overflow = "";
      setTimeout(() => {
        overlay.style.display = "none";
      }, 550);
    });

    document.body.style.overflow = "hidden";
    overlay.addEventListener("transitionend", () => {}, { once: true });
  }

  /* ---------------------------------------------------------
     14. HEADER: SCROLL SHADOW + MENÚ MÓVIL
  --------------------------------------------------------- */
  function initHeaderBehavior() {
    const header = document.getElementById("site-header");
    const mobileBtn = document.getElementById("btn-mobile-menu");
    const mobileMenu = document.getElementById("mobile-menu");

    if (header) {
      window.addEventListener("scroll", () => {
        if (window.scrollY > 20) {
          header.classList.add("shadow-lg", "shadow-black/40");
        } else {
          header.classList.remove("shadow-lg", "shadow-black/40");
        }
      });
    }

    if (mobileBtn && mobileMenu) {
      mobileBtn.addEventListener("click", () => {
        mobileMenu.classList.toggle("hidden");
      });
      mobileMenu.querySelectorAll(".mobile-nav-link").forEach((link) => {
        link.addEventListener("click", () => mobileMenu.classList.add("hidden"));
      });
    }
  }

  /* ---------------------------------------------------------
     15. ACORDEÓN DE REGLAS
  --------------------------------------------------------- */
  function initAccordion() {
    const items = document.querySelectorAll("#accordion-rules .accordion-item");
    items.forEach((item) => {
      const toggle = item.querySelector(".accordion-toggle");
      if (!toggle) return;
      toggle.addEventListener("click", () => {
        const wasOpen = item.classList.contains("open");
        items.forEach((i) => i.classList.remove("open"));
        if (!wasOpen) item.classList.add("open");
      });
    });
  }

  /* ---------------------------------------------------------
     16. REVEAL ON SCROLL
  --------------------------------------------------------- */
  function initRevealOnScroll() {
    const targets = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || !targets.length) {
      targets.forEach((t) => t.classList.add("in-view"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    targets.forEach((t) => observer.observe(t));
  }

  /* ---------------------------------------------------------
     17. FOOTER YEAR
  --------------------------------------------------------- */
  function initFooterYear() {
    const el = document.getElementById("footer-year");
    if (el) el.textContent = new Date().getFullYear();
  }

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    initHeaderLogo();
    initMatchFoundOverlay();
    initHeaderBehavior();
    initAccordion();
    initRevealOnScroll();
    initFooterYear();
    initAdminGate();
    initTeamForm();
    initMatchForm();
    initMatchesListEvents();
    initBackupSystem();

    await initState(); // carga desde Firestore y activa la sincronización en tiempo real
  });
})();
