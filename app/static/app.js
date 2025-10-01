"use strict";

/* ============================================================================
 * Utilidades
 * ==========================================================================*/

/**
 * Atajo para querySelector.
 * @param {string} sel - Selector CSS.
 * @returns {Element|null}
 */
const $ = (sel) => document.querySelector(sel);

/**
 * Formatea una fecha ISO a YYYY-MM-DD (o cadena vacía si no hay valor).
 * @param {string} iso
 * @returns {string}
 */
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : "");

/**
 * Serializa un objeto sencillo a querystring ignorando undefined, null y "".
 * @param {Record<string, any>} obj
 * @returns {string}
 */
const qs = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

/**
 * Realiza un GET y devuelve JSON. Lanza Error si el status no es OK.
 * @param {string} url
 */
async function jsonGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

/**
 * Realiza un POST JSON y devuelve el JSON de respuesta.
 * Extrae mensaje de error del backend si existe.
 * @param {string} url
 * @param {any} body
 */
async function jsonPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Intenta parsear JSON; si falla, usa objeto vacío
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      data?.errores?.join?.("; ") ||
      data?.message ||
      `Error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/* ============================================================================
 * Estado (filtros/paginación)
 * ==========================================================================*/

const state = {
  emp: { page: 1, per_page: 10, q: "", sector: "" },
  his: { page: 1, per_page: 10, ticker: "", desde: "", hasta: "" },
};

/* ============================================================================
 * Empresas (listado + paginado)
 * ==========================================================================*/

/**
 * Carga empresas desde /empresas con filtros/paginación de state.emp
 * y pinta la lista y controles.
 */
async function loadEmpresas() {
  const { page, per_page, q, sector } = state.emp;
  const query = qs({ page, per_page, q, sector });
  const data = await jsonGet(`/empresas?${query}`);

  // La API puede devolver array directo o estructura paginada
  const items = Array.isArray(data) ? data : data.items;
  const total = Array.isArray(data) ? items.length : data.total;
  const hasNext = Array.isArray(data) ? false : data.has_next;

  // Render de filas
  $("#emp-list").innerHTML = (items || [])
    .map(
      (e) => `
        <div class="row" style="justify-content:space-between;border-bottom:1px solid #e2e8f0;padding:6px 0;">
          <div><strong>${e.ticker}</strong> — ${e.nombre}</div>
          <span class="muted">${e.sector}</span>
        </div>`
    )
    .join("");

  // Render de metadatos/paginación
  $("#emp-total").textContent = `${total} resultados`;
  $("#emp-page").textContent = `p. ${state.emp.page}`;
  $("#emp-prev").disabled = state.emp.page <= 1;
  $("#emp-next").disabled = !hasNext;
}

/**
 * Enlaza eventos de búsqueda y paginado del bloque de empresas.
 */
function bindEmpresas() {
  $("#emp-buscar").addEventListener("click", () => {
    state.emp.q = $("#emp-q").value.trim();
    state.emp.sector = $("#emp-sector").value.trim();
    state.emp.page = 1;
    loadEmpresas().catch((e) => alert(e.message));
  });

  $("#emp-prev").addEventListener("click", () => {
    if (state.emp.page > 1) {
      state.emp.page--;
      loadEmpresas().catch((e) => alert(e.message));
    }
  });

  $("#emp-next").addEventListener("click", () => {
    state.emp.page++;
    loadEmpresas().catch((e) => alert(e.message));
  });
}

/* ============================================================================
 * Análisis (formulario + envío)
 * ==========================================================================*/

/**
 * Construye el payload de análisis a partir de los inputs del formulario.
 * @returns {object}
 */
function payloadAnalisis() {
  return {
    ticker: document.getElementById("anl-ticker").value.trim(),
    importe_inicial: Number(document.getElementById("anl-importe").value),
    horizonte_anios: Number(document.getElementById("anl-horizonte").value),
    supuestos: {
      crecimiento_anual_pct: Number(document.getElementById("anl-crec").value),
      margen_seguridad_pct: Number(document.getElementById("anl-margen").value),
      roe_pct: Number(document.getElementById("anl-roe").value),
      deuda_sobre_activos_pct: Number(document.getElementById("anl-deuda").value),
    },
    justificacion: document.getElementById("anl-just").value,
  };
}

/**
 * Pinta las observaciones como chips/pills.
 * @param {{tipo:'ok'|'alerta'|'mejora', msg:string}[]} list
 */
function renderObservaciones(list) {
  $("#anl-observaciones").innerHTML = (list || [])
    .map((o) => {
      const cls = o.tipo === "ok" ? "ok" : o.tipo === "alerta" ? "alerta" : "mejora";
      return `<span class="pill ${cls}">${o.msg}</span>`;
    })
    .join("");
}

/**
 * Enlaza el formulario de análisis: validación, envío y render de resultado.
 */
function bindAnalisisForm() {
  const btn = document.getElementById("anl-enviar");

  // Limpieza de errores por campo al teclear
  [
    "anl-ticker", "anl-importe", "anl-horizonte", "anl-crec",
    "anl-margen", "anl-roe", "anl-deuda", "anl-just",
  ].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => {
      const map = {
        "anl-ticker": "ticker",
        "anl-importe": "importe",
        "anl-horizonte": "horizonte",
        "anl-crec": "crec",
        "anl-margen": "margen",
        "anl-roe": "roe",
        "anl-deuda": "deuda",
        "anl-just": "just",
      };
      const k = map[id];
      const err = document.getElementById(`err-${k}`);
      if (err) err.textContent = "";
      el.classList.remove("invalid");
    });
  });

  // Envío
  btn.addEventListener("click", async () => {
    clearErrors();
    const p = payloadAnalisis();
    const errs = validateForm(p);
    if (Object.keys(errs).length) {
      showErrors(errs);
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Analizando…";

      const r = await jsonPost("/analisis", p);

      document.getElementById("anl-resultado").textContent =
        `Puntuación: ${r.puntuacion} — ${r.resumen}`;

      renderObservaciones(r.observaciones);

      // Refresca historial
      state.his.page = 1;
      await loadHistorial();
    } catch (e) {
      alert(`No se pudo analizar:\n${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Analizar";
    }
  });
}

/* ============================================================================
 * Historial (lista + filtros + paginado + CSV)
 * ==========================================================================*/

/**
 * Carga entradas del historial y pinta tabla + paginación.
 */
async function loadHistorial() {
  const { page, per_page, ticker, desde, hasta } = state.his;
  const query = qs({ page, per_page, ticker, desde, hasta });
  const data = await jsonGet(`/analisis?${query}`);

  const items = Array.isArray(data) ? data : data.items;
  const total = Array.isArray(data) ? items.length : data.total;
  const hasNext = Array.isArray(data) ? false : data.has_next;

  // Render de filas
  $("#his-tbody").innerHTML = (items || [])
    .map((h) => {
      // guardamos observaciones serializadas para el botón "Ver"
      const obs = JSON.stringify(h.observaciones || []);
      return `
        <tr>
          <td class="muted">${fmtDate(h.timestamp)}</td>
          <td><strong>${h.ticker || ""}</strong></td>
          <td>${h.importe_inicial ?? ""}</td>
          <td>${h.horizonte_anios ?? ""} años</td>
          <td><strong>${h.puntuacion ?? ""}</strong></td>
          <td>
            ${(h.resumen || "").replace(/\n/g, " ")}
            <button
              class="secondary btn-obs"
              data-obs='${obs.replaceAll("'", "&apos;")}'
              style="margin-left:6px;">
              Ver
            </button>
          </td>
        </tr>`;
    })
    .join("");

  // Enlaza botones "Ver" de esta página
  document.querySelectorAll("#his-tbody .btn-obs").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = JSON.parse(btn.getAttribute("data-obs") || "[]");
      openObservacionesModal(list);
    });
  });

  // Controles de paginación del historial
  $("#his-total").textContent = `${total} resultados`;
  $("#his-page").textContent = `p. ${state.his.page}`;
  $("#his-prev").disabled = state.his.page <= 1;
  $("#his-next").disabled = !hasNext;
}

/**
 * Descarga CSV del historial según filtros actuales (sin paginado).
 */
function exportCSV() {
  const { ticker, desde, hasta } = state.his;
  const query = qs({ ticker, desde, hasta });
  const url = `/analisis.csv${query ? "?" + query : ""}`;
  window.location.href = url;
}

/**
 * Enlaza filtros y paginación del historial.
 */
function bindHistorial() {
  $("#his-filtrar").addEventListener("click", () => {
    state.his.ticker = $("#his-ticker").value.trim();
    state.his.desde = $("#his-desde").value || "";
    state.his.hasta = $("#his-hasta").value || "";
    state.his.page = 1;
    loadHistorial().catch((e) => alert(e.message));
  });

  $("#his-prev").addEventListener("click", () => {
    if (state.his.page > 1) {
      state.his.page--;
      loadHistorial().catch((e) => alert(e.message));
    }
  });

  $("#his-next").addEventListener("click", () => {
    state.his.page++;
    loadHistorial().catch((e) => alert(e.message));
  });

  $("#his-export").addEventListener("click", exportCSV);
}

/* ============================================================================
 * Validación de formulario de análisis
 * ==========================================================================*/

/**
 * Limpia mensajes de error y estilos "invalid".
 */
function clearErrors() {
  ["ticker", "importe", "horizonte", "crec", "margen", "roe", "deuda", "just"].forEach((k) => {
    const el = document.getElementById(`err-${k}`);
    if (el) el.textContent = "";
  });

  [
    "anl-ticker", "anl-importe", "anl-horizonte", "anl-crec",
    "anl-margen", "anl-roe", "anl-deuda", "anl-just",
  ].forEach((id) => document.getElementById(id)?.classList.remove("invalid"));
}

/**
 * Devuelve diccionario de errores por campo si hay validaciones incumplidas.
 * @param {ReturnType<typeof payloadAnalisis>} p
 */
function validateForm(p) {
  const errs = {};

  if (!p.ticker) errs.ticker = "Obligatorio.";
  if (!(p.importe_inicial > 0)) errs.importe = "Debe ser > 0.";
  if (!(Number.isInteger(p.horizonte_anios) && p.horizonte_anios >= 5)) {
    errs.horizonte = "Debe ser entero ≥ 5.";
  }

  const sup = p.supuestos || {};
  const within = (v) => Number.isFinite(v) && v >= 0 && v <= 100;
  if (!within(sup.crecimiento_anual_pct)) errs.crec = "Debe estar entre 0 y 100.";
  if (!within(sup.margen_seguridad_pct)) errs.margen = "Debe estar entre 0 y 100.";
  if (!within(sup.roe_pct)) errs.roe = "Debe estar entre 0 y 100.";
  if (!within(sup.deuda_sobre_activos_pct)) errs.deuda = "Debe estar entre 0 y 100.";

  if (!p.justificacion || p.justificacion.trim().length < 20) {
    errs.just = "Mínimo 20 caracteres.";
  }

  return errs;
}

/**
 * Muestra los errores en su <span id="err-..."> y marca inputs como invalid.
 * Hace scroll al primero inválido.
 * @param {Record<string,string>} errs
 */
function showErrors(errs) {
  const map = {
    ticker: "anl-ticker",
    importe: "anl-importe",
    horizonte: "anl-horizonte",
    crec: "anl-crec",
    margen: "anl-margen",
    roe: "anl-roe",
    deuda: "anl-deuda",
    just: "anl-just",
  };

  let firstInvalid = null;

  Object.entries(errs).forEach(([k, msg]) => {
    const errEl = document.getElementById(`err-${k}`);
    if (errEl) errEl.textContent = msg;

    const input = document.getElementById(map[k]);
    if (input) {
      input.classList.add("invalid");
      if (!firstInvalid) firstInvalid = input;
    }
  });

  if (firstInvalid) {
    firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function readParams() {
  const p = new URLSearchParams(location.search);

  // Empresas
  state.emp.q = p.get("emp_q") ?? "";
  state.emp.sector = p.get("emp_sector") ?? "";
  state.emp.page = Number(p.get("emp_page") ?? 1) || 1;
  state.emp.per_page = Number(p.get("emp_per_page") ?? state.emp.per_page) || 10;

  // Historial
  state.his.ticker = p.get("his_ticker") ?? "";
  state.his.desde = p.get("his_desde") ?? "";
  state.his.hasta = p.get("his_hasta") ?? "";
  state.his.page = Number(p.get("his_page") ?? 1) || 1;
  state.his.per_page = Number(p.get("his_per_page") ?? state.his.per_page) || 10;
}

function writeParams(replace = true) {
  const p = new URLSearchParams(location.search);

  // Empresas
  state.emp.q ? p.set("emp_q", state.emp.q) : p.delete("emp_q");
  state.emp.sector ? p.set("emp_sector", state.emp.sector) : p.delete("emp_sector");
  state.emp.page > 1 ? p.set("emp_page", String(state.emp.page)) : p.delete("emp_page");
  state.emp.per_page !== 10 ? p.set("emp_per_page", String(state.emp.per_page)) : p.delete("emp_per_page");

  // Historial
  state.his.ticker ? p.set("his_ticker", state.his.ticker) : p.delete("his_ticker");
  state.his.desde ? p.set("his_desde", state.his.desde) : p.delete("his_desde");
  state.his.hasta ? p.set("his_hasta", state.his.hasta) : p.delete("his_hasta");
  state.his.page > 1 ? p.set("his_page", String(state.his.page)) : p.delete("his_page");
  state.his.per_page !== 10 ? p.set("his_per_page", String(state.his.per_page)) : p.delete("his_per_page");

  const url = `${location.pathname}?${p.toString()}`;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
}


/* ============================================================================
 * Observaciones (modal accesible)
 * ==========================================================================*/

/**
 * Renderiza lista de observaciones como chips (HTML).
 */
function renderObsChips(list) {
  return (
    (list || [])
      .map((o) => {
        const cls = o.tipo === "ok" ? "ok" : o.tipo === "alerta" ? "alerta" : "mejora";
        return `<div class="pill ${cls}" style="display:inline-block;margin:4px 6px 0 0;">${o.msg}</div>`;
      })
      .join("") || "<span class='muted'>Sin observaciones</span>"
  );
}

// Gestión de foco para accesibilidad
let _lastFocused = null;

/**
 * Abre el modal de observaciones con la lista dada.
 * @param {Array} observaciones
 */
function openObservacionesModal(observaciones) {
  const mb = document.getElementById("modal");
  const body = document.getElementById("modal-body");

  body.innerHTML = renderObsChips(observaciones);

  _lastFocused = document.activeElement;
  mb.style.display = "flex";
  mb.setAttribute("aria-hidden", "false");
  document.getElementById("modal-close").focus();

  const onKey = (e) => {
    if (e.key === "Escape") closeObservacionesModal();
  };
  mb._escHandler = onKey;
  document.addEventListener("keydown", mb._escHandler);
}

/**
 * Cierra el modal y restaura el foco.
 */
function closeObservacionesModal() {
  const mb = document.getElementById("modal");
  mb.style.display = "none";
  mb.setAttribute("aria-hidden", "true");

  if (mb._escHandler) {
    document.removeEventListener("keydown", mb._escHandler);
    mb._escHandler = null;
  }
  if (_lastFocused && typeof _lastFocused.focus === "function") {
    _lastFocused.focus();
  }
}

/* ============================================================================
 * Boot (DOMContentLoaded)
 * ==========================================================================*/

document.addEventListener("DOMContentLoaded", async () => {
  // 1) Estado inicial desde la URL
  readParams();

  // 2) Enlazar handlers
  bindEmpresas();
  bindAnalisisForm();
  bindHistorial();

  // 3) Volcar valores iniciales a los inputs
  $("#emp-q").value = state.emp.q || "";
  $("#emp-sector").value = state.emp.sector || "";

  $("#his-ticker").value = state.his.ticker || "";
  $("#his-desde").value = state.his.desde || "";
  $("#his-hasta").value = state.his.hasta || "";

  // 4) Cargar sectores (no bloqueante)
  try {
    await loadSectores();
  } catch (e) {
    console.warn("No se pudieron cargar sectores:", e);
  }

  // 5) Cargar datos iniciales
  loadEmpresas().catch((e) => alert(e.message));
  loadHistorial().catch((e) => alert(e.message));

  // 6) Modal: cerrar con botón
  document.getElementById("modal-close").addEventListener("click", closeObservacionesModal);

  // 7) Modal: cerrar al hacer click fuera del cuadro
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeObservacionesModal();
  });

  // 8) Navegación con atrás/adelante
  window.addEventListener("popstate", async () => {
    readParams();

    // Refrescar inputs para que coincidan con la URL
    $("#emp-q").value = state.emp.q || "";
    $("#emp-sector").value = state.emp.sector || "";

    $("#his-ticker").value = state.his.ticker || "";
    $("#his-desde").value = state.his.desde || "";
    $("#his-hasta").value = state.his.hasta || "";

    await Promise.all([
      loadEmpresas().catch((e) => console.error(e)),
      loadHistorial().catch((e) => console.error(e)),
    ]);
  });
});


/* ============================================================================
 * Auxiliares de datos (sectores)
 * ==========================================================================*/

/**
 * Carga sectores en el <select id="emp-sector"> manteniendo la opción "Todos".
 */
async function loadSectores() {
  const sectores = await jsonGet("/empresas/sectores");
  const sel = $("#emp-sector");
  sel.innerHTML =
    `<option value="">Todos los sectores</option>` +
    sectores.map((s) => `<option value="${s}">${s}</option>`).join("");
}
