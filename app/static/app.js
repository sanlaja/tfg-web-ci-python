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

// --- Utilidad: ordenar arrays de objetos por clave y dirección ---
function sortItems(items, key, dir = "asc") {
  const d = dir === "desc" ? -1 : 1;
  const toNum = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const isDateKey = (k) => k.toLowerCase().includes("time") || k.toLowerCase().includes("date");
  const isNumericKey = (k, sample) => Number.isFinite(toNum(sample?.[k]));

  return [...(items || [])].sort((a, b) => {
    const va = a?.[key], vb = b?.[key];

    // Fecha ISO
    if (isDateKey(key) || key === "timestamp") {
      const na = va ? Date.parse(va) : 0;
      const nb = vb ? Date.parse(vb) : 0;
      if (na < nb) return -1 * d;
      if (na > nb) return 1 * d;
      return 0;
    }

    // Números
    if (isNumericKey(key, a) || isNumericKey(key, b)) {
      const na = toNum(va), nb = toNum(vb);
      if (isNaN(na) && isNaN(nb)) return 0;
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      if (na < nb) return -1 * d;
      if (na > nb) return 1 * d;
      return 0;
    }

    // Texto (localeCompare insensible a mayúsculas)
    const sa = String(va ?? "").toLocaleLowerCase();
    const sb = String(vb ?? "").toLocaleLowerCase();
    return sa.localeCompare(sb) * d;
  });
}

// --- Utilidad: copiar URL actual al portapapeles ---
async function copyCurrentUrl() {
  try {
    await navigator.clipboard.writeText(location.href);
    alert("URL copiada al portapapeles ✅");
  } catch {
    // Fallback clásico
    const ta = document.createElement("textarea");
    ta.value = location.href;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("URL copiada (fallback) ✅");
  }
}

// --- Utilidad: resaltar coincidencias en texto (para Empresas) ---
function highlight(text, needle) {
  if (!needle) return String(text ?? "");
  const esc = String(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${esc})`, "ig");
  return String(text ?? "").replace(re, "<mark class='hl'>$1</mark>");
}

/* ============================================================================
 * Estado (filtros/paginación/orden)
 * ==========================================================================*/

const state = {
  emp: { page: 1, per_page: 10, q: "", sector: "", sort: "ticker", dir: "asc" },
  his: { page: 1, per_page: 10, ticker: "", desde: "", hasta: "", sort: "timestamp", dir: "desc" },
};

/* ============================================================================
 * Empresas (listado + paginado + orden)
 * ==========================================================================*/

/**
 * Carga empresas desde /empresas con filtros/paginación de state.emp
 * y pinta la tabla (usa #emp-tbody).
 */
async function loadEmpresas() {
  // Skeletons (5 filas) mientras carga
  const empTbody = document.getElementById("emp-tbody");
  if (empTbody) {
    empTbody.innerHTML = Array.from({ length: 5 })
      .map(
        () => `
        <tr>
          <td><div class="skel" style="height:14px; width:80px;"></div></td>
          <td><div class="skel" style="height:14px; width:180px;"></div></td>
          <td><div class="skel" style="height:14px; width:100px;"></div></td>
        </tr>`
      )
      .join("");
  }

  const { page, per_page, q, sector } = state.emp;
  const query = qs({ page, per_page, q, sector });
  const data = await jsonGet(`/empresas?${query}`);

  // La API puede devolver array directo o estructura paginada
  const arrayMode = Array.isArray(data);
  const items = arrayMode ? data : data.items;
  const total = arrayMode ? (items || []).length : data.total;
  const hasNext = arrayMode ? false : data.has_next;

  // Ordenación cliente (sobre la página actual)
  const itemsSorted = sortItems(items || [], state.emp.sort, state.emp.dir);
  const needle = state.emp.q || "";

  // Render de filas
  if (empTbody) {
    empTbody.innerHTML = (itemsSorted || []).length
      ? itemsSorted
          .map((e) => {
            const nombre = highlight(e.nombre, needle);
            const ticker = highlight(e.ticker, needle);
            return `
              <tr>
                <td><strong>${ticker}</strong></td>
                <td>${nombre}</td>
                <td><span class="badge sector">${e.sector}</span></td>
              </tr>`;
          })
          .join("")
      : `<tr><td colspan="3"><div class="empty">No hay resultados para tu búsqueda.</div></td></tr>`;
  }

  // Info de paginación
  const infoEl = $("#emp-info");
  if (arrayMode) {
    infoEl.textContent = `${total} resultados`;
  } else {
    const start = total === 0 ? 0 : (page - 1) * per_page + 1;
    const end = total === 0 ? 0 : Math.min(start + (items?.length || 0) - 1, total);
    infoEl.textContent =
      total === 0
        ? "0 resultados"
        : `Mostrando ${start}–${end} de ${total} · p. ${page} · ${per_page}/pág`;
  }

  // Botones
  $("#emp-prev").disabled = state.emp.page <= 1;
  $("#emp-next").disabled = !hasNext;
}

/**
 * Enlaza eventos de búsqueda, paginado y "compartir" en Empresas.
 */
function bindEmpresas() {
  // Buscar
  $("#emp-buscar").addEventListener("click", () => {
    state.emp.q = $("#emp-q").value.trim();
    state.emp.sector = $("#emp-sector").value.trim();
    state.emp.page = 1;
    writeParams();
    loadEmpresas().catch((e) => alert(e.message));
  });

  // Por página
  const perSel = $("#emp-per-page");
  perSel.addEventListener("change", () => {
    state.emp.per_page = Number(perSel.value) || 10;
    state.emp.page = 1;
    writeParams();
    loadEmpresas().catch((e) => alert(e.message));
  });

  // Prev / Next
  $("#emp-prev").addEventListener("click", () => {
    if (state.emp.page > 1) {
      state.emp.page--;
      writeParams();
      loadEmpresas().catch((e) => alert(e.message));
    }
  });

  $("#emp-next").addEventListener("click", () => {
    state.emp.page++;
    writeParams();
    loadEmpresas().catch((e) => alert(e.message));
  });

  // Share URL (Empresas) — solo si existe el botón
  const empShareBtn = $("#emp-share");
  if (empShareBtn) {
    empShareBtn.addEventListener("click", async () => {
      writeParams();        // asegura que la URL refleja el estado actual
      await copyCurrentUrl();
    });
  }
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

      // Refresca historial al principio
      state.his.page = 1;
      writeParams();
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
 * Historial (lista + filtros + paginado + CSV + orden)
 * ==========================================================================*/

/**
 * Carga entradas del historial y pinta tabla + paginación.
 */
async function loadHistorial() {
  const { page, per_page, ticker, desde, hasta } = state.his;
  const query = qs({ page, per_page, ticker, desde, hasta });
  const data = await jsonGet(`/analisis?${query}`);

  const arrayMode = Array.isArray(data);
  const items = arrayMode ? data : data.items;
  const total = arrayMode ? (items || []).length : data.total;
  const hasNext = arrayMode ? false : data.has_next;

  // Ordenación cliente (sobre la página actual)
  const itemsSorted = sortItems(items || [], state.his.sort, state.his.dir);

  // Render de filas con badge de puntuación + empty-state
  const rows = (itemsSorted || [])
    .map((h) => {
      let scoreClass = "score-mid";
      const sc = Number(h.puntuacion ?? 0);
      if (sc >= 80) scoreClass = "score-high";
      else if (sc < 60) scoreClass = "score-low";

      return `
        <tr>
          <td class="muted">${fmtDate(h.timestamp)}</td>
          <td><strong>${h.ticker || ""}</strong></td>
          <td>${h.importe_inicial ?? ""}</td>
          <td>${h.horizonte_anios ?? ""} años</td>
          <td><span class="badge ${scoreClass}">${h.puntuacion ?? ""}</span></td>
          <td>
            ${(h.resumen || "").replace(/\n/g, " ")}
            <button
              class="secondary btn-obs"
              data-obs='${JSON.stringify(h.observaciones || []).replaceAll("'", "&apos;")}'
              style="margin-left:6px;">
              Ver
            </button>
          </td>
        </tr>`;
    })
    .join("");

  $("#his-tbody").innerHTML =
    rows ||
    `<tr><td colspan="6">
       <div class="empty" style="padding:8px 0; color:#64748b;">
         Todavía no hay análisis en el historial.
       </div>
     </td></tr>`;

  // Enlaza botones "Ver" de esta página
  document.querySelectorAll("#his-tbody .btn-obs").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = JSON.parse(btn.getAttribute("data-obs") || "[]");
      openObservacionesModal(list);
    });
  });

  // Info de paginación (sustituye his-total/his-page por his-info)
  const infoEl = $("#his-info");
  if (arrayMode) {
    infoEl.textContent = `${total} resultados`;
  } else {
    const start = total === 0 ? 0 : (page - 1) * per_page + 1;
    const end = total === 0 ? 0 : Math.min(start + (items?.length || 0) - 1, total);
    infoEl.textContent =
      total === 0
        ? "0 resultados"
        : `Mostrando ${start}–${end} de ${total} · p. ${page} · ${per_page}/pág`;
  }

  // Controles de paginación del historial
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
    writeParams();
    loadHistorial().catch((e) => alert(e.message));
  });

  const perSel = $("#his-per-page");
  perSel.addEventListener("change", () => {
    state.his.per_page = Number(perSel.value) || 10;
    state.his.page = 1;
    writeParams();
    loadHistorial().catch((e) => alert(e.message));
  });

  $("#his-prev").addEventListener("click", () => {
    if (state.his.page > 1) {
      state.his.page--;
      writeParams();
      loadHistorial().catch((e) => alert(e.message));
    }
  });

  $("#his-next").addEventListener("click", () => {
    state.his.page++;
    writeParams();
    loadHistorial().catch((e) => alert(e.message));
  });

  $("#his-export").addEventListener("click", exportCSV);

  // Share URL (Historial) — solo si existe el botón
  const hisShareBtn = $("#his-share");
  if (hisShareBtn) {
    hisShareBtn.addEventListener("click", async () => {
      writeParams();
      await copyCurrentUrl();
    });
  }
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

/* ============================================================================
 * URL <-> Estado
 * ==========================================================================*/

/**
 * Lee parámetros desde la URL.
 * (Si quieres restaurar desde localStorage 24h, avísame y lo reañadimos aquí.)
 */
function readParams() {
  const p = new URLSearchParams(location.search);

  // --- Empresas ---
  state.emp.q = p.get("emp_q") ?? state.emp.q;
  state.emp.sector = p.get("emp_sector") ?? state.emp.sector;
  state.emp.page = Number(p.get("emp_page") ?? state.emp.page) || 1;
  state.emp.per_page = Number(p.get("emp_per_page") ?? state.emp.per_page) || 10;
  state.emp.sort = p.get("emp_sort") ?? state.emp.sort;
  state.emp.dir  = p.get("emp_dir")  ?? state.emp.dir;

  // --- Historial ---
  state.his.ticker = p.get("his_ticker") ?? state.his.ticker;
  state.his.desde = p.get("his_desde") ?? state.his.desde;
  state.his.hasta = p.get("his_hasta") ?? state.his.hasta;
  state.his.page = Number(p.get("his_page") ?? state.his.page) || 1;
  state.his.per_page = Number(p.get("his_per_page") ?? state.his.per_page) || 10;
  state.his.sort = p.get("his_sort") ?? state.his.sort;
  state.his.dir  = p.get("his_dir")  ?? state.his.dir;
}

/**
 * Escribe el estado actual en la URL (querystring).
 */
function writeParams(replace = true) {
  const p = new URLSearchParams(location.search);

  // --- Empresas ---
  state.emp.q ? p.set("emp_q", state.emp.q) : p.delete("emp_q");
  state.emp.sector ? p.set("emp_sector", state.emp.sector) : p.delete("emp_sector");
  state.emp.page > 1 ? p.set("emp_page", String(state.emp.page)) : p.delete("emp_page");
  state.emp.per_page !== 10
    ? p.set("emp_per_page", String(state.emp.per_page))
    : p.delete("emp_per_page");
  state.emp.sort ? p.set("emp_sort", state.emp.sort) : p.delete("emp_sort");
  state.emp.dir  ? p.set("emp_dir",  state.emp.dir)  : p.delete("emp_dir");

  // --- Historial ---
  state.his.ticker ? p.set("his_ticker", state.his.ticker) : p.delete("his_ticker");
  state.his.desde ? p.set("his_desde", state.his.desde) : p.delete("his_desde");
  state.his.hasta ? p.set("his_hasta", state.his.hasta) : p.delete("his_hasta");
  state.his.page > 1 ? p.set("his_page", String(state.his.page)) : p.delete("his_page");
  state.his.per_page !== 10
    ? p.set("his_per_page", String(state.his.per_page))
    : p.delete("his_per_page");
  state.his.sort ? p.set("his_sort", state.his.sort) : p.delete("his_sort");
  state.his.dir  ? p.set("his_dir",  state.his.dir)  : p.delete("his_dir");

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
 * Ordenación (click en encabezados)
 * ==========================================================================*/

function bindSorting() {
  // Empresas
  document.querySelectorAll("[data-sort-emp]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort-emp");
      if (!key) return;
      if (state.emp.sort === key) {
        state.emp.dir = state.emp.dir === "asc" ? "desc" : "asc";
      } else {
        state.emp.sort = key;
        state.emp.dir = "asc";
      }
      writeParams();
      loadEmpresas().catch((e) => alert(e.message));
    });
  });

  // Historial
  document.querySelectorAll("[data-sort-his]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort-his");
      if (!key) return;
      if (state.his.sort === key) {
        state.his.dir = state.his.dir === "asc" ? "desc" : "asc";
      } else {
        state.his.sort = key;
        state.his.dir = "asc";
      }
      writeParams();
      loadHistorial().catch((e) => alert(e.message));
    });
  });
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
  bindSorting();

  // 3) Volcar valores iniciales a los inputs
  $("#emp-q").value = state.emp.q || "";
  $("#emp-sector").value = state.emp.sector || "";
  $("#emp-per-page").value = String(state.emp.per_page);

  $("#his-ticker").value = state.his.ticker || "";
  $("#his-desde").value = state.his.desde || "";
  $("#his-hasta").value = state.his.hasta || "";
  $("#his-per-page").value = String(state.his.per_page);

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
    $("#emp-per-page").value = String(state.emp.per_page);

    $("#his-ticker").value = state.his.ticker || "";
    $("#his-desde").value = state.his.desde || "";
    $("#his-hasta").value = state.his.hasta || "";
    $("#his-per-page").value = String(state.his.per_page);

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
