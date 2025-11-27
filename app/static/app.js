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
 * Formatea una fecha ISO a YYYY-MM-DD (o cadena vacÃ­a si no hay valor).
 * @param {string} iso
 * @returns {string}
 */
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : "");

const euroFmt = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});
const pctFmt = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ND = "\u2014";

const fmtPct = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return ND;
  return `${pctFmt.format(num)}%`;
};

const fmtSignedPct = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return ND;
  const sign = num > 0 ? "+" : "";
  return `${sign}${pctFmt.format(num)}%`;
};

const fmtEur = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return ND;
  return euroFmt.format(num);
};

function applySignColor(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.classList.remove("text-pos", "text-neg");
  const num = Number(value);
  if (!Number.isFinite(num)) return;
  el.classList.add(num >= 0 ? "text-pos" : "text-neg");
}

function createCareerModal(options = {}) {
  const {
    id,
    title = "",
    labelledBy,
    contentClass = "",
    bodyClass = "",
    onClose,
  } = options;

  if (id) {
    const existing = document.getElementById(id);
    if (existing?.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  if (id) overlay.id = id;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const titleId = labelledBy || (id ? `${id}-title` : "career-modal-title");
  overlay.setAttribute("aria-labelledby", titleId);

  const content = document.createElement("div");
  content.className = ["modal__content", contentClass].filter(Boolean).join(" ");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal__close";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.textContent = "\u00D7";

  const header = document.createElement("div");
  header.className = "modal__header";
  const titleEl = document.createElement("h3");
  titleEl.id = titleId;
  titleEl.textContent = title;
  header.appendChild(titleEl);

  const body = document.createElement("div");
  body.className = ["modal__body", bodyClass].filter(Boolean).join(" ");

  const footer = document.createElement("div");
  footer.className = "modal__actions";

  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  function close(result) {
    document.removeEventListener("keydown", onKeyDown, true);
    overlay.remove();
    if (onClose) onClose(result);
    if (previouslyFocused?.focus) {
      previouslyFocused.focus();
    }
  }

  function onKeyDown(ev) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close(false);
    }
  }

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close(false);
  });
  closeBtn.addEventListener("click", () => close(false));
  document.addEventListener("keydown", onKeyDown, true);

  content.append(closeBtn, header, body, footer);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  return { overlay, content, body, footer, close };
}

function careerConfirm(message, options = {}) {
  const { title = "Confirmar acción", confirmText = "Continuar", cancelText = "Cancelar" } =
    options || {};
  return new Promise((resolve) => {
    let settled = false;
    const modal = createCareerModal({
      id: "career-confirm-modal",
      title,
      onClose: (result) => {
        if (settled) return;
        settled = true;
        resolve(Boolean(result));
      },
    });

    const paragraph = document.createElement("p");
    paragraph.className = "modal__message";
    paragraph.textContent = message;
    modal.body.appendChild(paragraph);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn btn-outline";
    cancelBtn.textContent = cancelText;

    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn btn-primary";
    okBtn.textContent = confirmText;

    modal.footer.append(cancelBtn, okBtn);

    cancelBtn.addEventListener("click", () => modal.close(false));
    okBtn.addEventListener("click", () => modal.close(true));

    requestAnimationFrame(() => okBtn.focus({ preventScroll: true }));
  });
}

function showBacktestSummary(ticker, start, end, summary) {
  const modal = document.getElementById("modalBacktest");
  if (!modal) return;

  const data = summary || {};
  const safeStart = start || data.start || "";
  const safeEnd = end || data.end || safeStart;
  const notes = Array.isArray(data.notes) ? data.notes : [];

  const setText = (selector, text) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = text;
  };

  setText("#mb_ticker", ticker || data.ticker || "");
  setText("#mb_periodo", safeEnd ? `${safeStart} \u2192 ${safeEnd}` : safeStart);
  setText("#mb_inv_ini", fmtEur(data.invested));
  setText("#mb_valor_final", fmtEur(data.final_value));
  setText("#mb_pnl_abs", fmtEur(data.pnl_abs));
  setText("#mb_pnl_pct", fmtPct(data.pnl_pct));
  setText("#mb_p0a", fmtEur(data.start_price_adj));
  setText("#mb_p1a", fmtEur(data.end_price_adj));
  setText("#mb_vara", fmtPct(data.variation_adj_pct));
  setText("#mb_p0", fmtEur(data.start_price));
  setText("#mb_p1", fmtEur(data.end_price));
  setText("#mb_var", fmtPct(data.variation_raw_pct));
  setText(
    "#mb_now",
    data.now_price !== null && data.now_price !== undefined
      ? fmtEur(data.now_price)
      : "No disponible"
  );
  setText("#mb_div", data.has_dividends ? 'S\u00ed' : 'No');

  applySignColor("#mb_pnl_abs", data.pnl_abs);
  applySignColor("#mb_pnl_pct", data.pnl_pct);
  applySignColor("#mb_vara", data.variation_adj_pct);
  applySignColor("#mb_var", data.variation_raw_pct);

  const notesEl = document.getElementById("mb_notes");
  if (notesEl) {
    notesEl.innerHTML = notes.length
      ? `<ul>${notes.map((n) => `<li>${n}</li>`).join("")}</ul>`
      : "";
  }

  const csvEnd = safeEnd || new Date().toISOString().slice(0, 10);
  const base = `/market/ohlc_csv?ticker=${encodeURIComponent(
    ticker || data.ticker || ""
  )}&start=${encodeURIComponent(safeStart)}&end=${encodeURIComponent(csvEnd)}`;
  const adjLink = document.getElementById("mb_csv_adj");
  if (adjLink) adjLink.href = `${base}&adjusted=true`;
  const rawLink = document.getElementById("mb_csv_raw");
  if (rawLink) rawLink.href = `${base}&adjusted=false`;

  modal.classList.remove("hidden");
}

function fixMojibake(str) {
  if (typeof str !== "string") return str;
  if (!/[\u00c3\u00c2]/.test(str)) return str;
  try {
    const bytes = Uint8Array.from([...str].map((ch) => ch.charCodeAt(0)));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return str;
  }
}

function setupBacktestModal() {
  const modal = document.getElementById("modalBacktest");
  if (!modal || modal.__backtestWired) return;

  const closeBtn = document.getElementById("modalBacktestClose");
  closeBtn?.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  modal.addEventListener("click", (evt) => {
    if (evt.target === modal) {
      modal.classList.add("hidden");
    }
  });

  modal.__backtestWired = true;
}

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

// --- Loader global de la aplicación ----------------------------------------
let _globalLoadingCounter = 0;

function setGlobalLoadingVisible(visible) {
  const el = document.getElementById("global-loading");
  if (!el) return;
  if (visible) {
    el.classList.add("is-visible");
    el.setAttribute("aria-hidden", "false");
  } else {
    el.classList.remove("is-visible");
    el.setAttribute("aria-hidden", "true");
  }
}

function pushGlobalLoading() {
  _globalLoadingCounter += 1;
  if (_globalLoadingCounter === 1) {
    setGlobalLoadingVisible(true);
  }
}

function popGlobalLoading() {
  _globalLoadingCounter = Math.max(0, _globalLoadingCounter - 1);
  if (_globalLoadingCounter === 0) {
    setGlobalLoadingVisible(false);
  }
}

/**
 * Mapea los turnos (range.end) al label de fecha más cercano en el eje X.
 * Regla: se usa el último día de mercado <= end; si ninguno, se usa el primer label.
 * Devuelve un array de labels únicos (sin duplicados).
 */
function mapTurnEndsToNearestLabels(turns, labels) {
  if (!Array.isArray(turns) || !Array.isArray(labels) || labels.length === 0) {
    return [];
  }

  const labelTimes = labels.map((d) => {
    const t = new Date(d).getTime();
    return Number.isNaN(t) ? null : t;
  });

  const result = [];

  (turns || []).forEach((turn) => {
    const end = turn?.range?.end;
    if (!end) return;

    const endTs = new Date(end).getTime();
    if (Number.isNaN(endTs)) return;

    let bestIndex = -1;
    for (let i = 0; i < labelTimes.length; i++) {
      const lt = labelTimes[i];
      if (lt == null) continue;
      if (lt <= endTs) {
        bestIndex = i;
      } else {
        break;
      }
    }

    if (bestIndex === -1) {
      bestIndex = labelTimes.findIndex((lt) => lt != null);
      if (bestIndex === -1) return;
    }

    const chosenLabel = labels[bestIndex];
    if (!result.includes(chosenLabel)) {
      result.push(chosenLabel);
    }
  });

  return result;
}

/**
 * Realiza un GET y devuelve JSON. Lanza Error si el status no es OK.
 * @param {string} url
 */
async function jsonGet(url) {
  pushGlobalLoading();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
    return await res.json();
  } finally {
    popGlobalLoading();
  }
}

/**
 * Realiza un POST JSON y devuelve el JSON de respuesta.
 * Extrae mensaje de error del backend si existe.
 * @param {string} url
 * @param {any} body
 */
async function jsonPost(url, body) {
  pushGlobalLoading();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Intenta parsear JSON; si falla, usa objeto vacÃ­o
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg =
        data?.errores?.join?.("; ") ||
        data?.message ||
        `Error ${res.status}`;
      const error = new Error(msg);
      error.status = res.status;
      error.body = data;
      error.url = url;
      throw error;
    }
    return data;
  } finally {
    popGlobalLoading();
  }
}

// --- Utilidad: ordenar arrays de objetos por clave y direcciÃ³n ---
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

    // NÃºmeros
    if (isNumericKey(key, a) || isNumericKey(key, b)) {
      const na = toNum(va), nb = toNum(vb);
      if (isNaN(na) && isNaN(nb)) return 0;
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      if (na < nb) return -1 * d;
      if (na > nb) return 1 * d;
      return 0;
    }

    // Texto (localeCompare insensible a mayÃºsculas)
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
    // Fallback clÃ¡sico
    const ta = document.createElement("textarea");
    ta.value = location.href;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    alert("URL copiada (fallback) ✅");
  }
}

// --- Utilidad: resaltar coincidencias en texto (para Ejemplos de empresas) ---
function highlight(text, needle) {
  if (!needle) return String(text ?? "");
  const esc = String(needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${esc})`, "ig");
  return String(text ?? "").replace(re, "<mark class='hl'>$1</mark>");
}

/* ============================================================================
 * Estado (filtros/paginaciÃ³n/orden)
 * ==========================================================================*/

const state = {
  emp: { page: 1, per_page: 10, q: "", sector: "", sort: "ticker", dir: "asc" },
  his: { page: 1, per_page: 10, ticker: "", desde: "", hasta: "", sort: "timestamp", dir: "desc" },
  career: { bench: "^GSPC" },
};

/* ============================================================================
 * Ejemplos de empresas (listado + paginado + orden)
 * ==========================================================================*/

/**
 * Carga empresas desde /empresas con filtros/paginaciÃ³n de state.emp
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
  const data = await jsonGet(`/empresas-data?${query}`);

  // La API puede devolver array directo o estructura paginada
  const arrayMode = Array.isArray(data);
  const items = arrayMode ? data : data.items;
  const total = arrayMode ? (items || []).length : data.total;
  const hasNext = arrayMode ? false : data.has_next;

  // OrdenaciÃ³n cliente (sobre la pÃ¡gina actual)
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
      : `<tr><td colspan="3"><div class="empty">No hay resultados para tu bÃºsqueda.</div></td></tr>`;
  }

  // Info de paginaciÃ³n
  const infoEl = $("#emp-info");
  if (arrayMode) {
    infoEl.textContent = `${total} resultados`;
  } else {
    const start = total === 0 ? 0 : (page - 1) * per_page + 1;
    const end = total === 0 ? 0 : Math.min(start + (items?.length || 0) - 1, total);
    infoEl.textContent =
      total === 0
        ? "0 resultados"
        : `Mostrando ${start} - ${end} de ${total} · pág. ${page} · ${per_page}/pág`;
  }

  // Botones
  $("#emp-prev").disabled = state.emp.page <= 1;
  $("#emp-next").disabled = !hasNext;
}

/**
 * Enlaza eventos de bÃºsqueda, paginado y "compartir" en Ejemplos de empresas.
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

  // Por pÃ¡gina
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

  // Share URL (Ejemplos de empresas) — solo si existe el botón
  const empShareBtn = $("#emp-share");
  if (empShareBtn) {
    empShareBtn.addEventListener("click", async () => {
      writeParams();        // asegura que la URL refleja el estado actual
      await copyCurrentUrl();
    });
  }
}

/* ============================================================================
 * AnÃ¡lisis (formulario + envÃ­o)
 * ==========================================================================*/

/**
 * Construye el payload de anÃ¡lisis a partir de los inputs del formulario.
 * @returns {object}
 */
function campoNumericoNullable(sel) {
  const el = $(sel);
  if (!el) return null;
  const v = el.value;
  if (v === "" || v === null || v === undefined) return null;
  return Number(v);
}

function construirPayloadPropuesta() {
  const isDca = document.getElementById("modo-dca")?.checked ?? true;

  const payload = {
    ticker: (document.getElementById("anl-ticker")?.value || "").trim().toUpperCase(),
    importe_inicial: Number(document.getElementById("importe-inicial")?.value || 0),
    horizonte_anios: Number(document.getElementById("horizonte-anios")?.value || 0),
    crecimiento_anual_estimado: campoNumericoNullable("#crecimiento-estimado"),
    margen_seguridad_pct: campoNumericoNullable("#margen-seguridad"),
    justificacion: (document.getElementById("justificacion")?.value || "").trim(),
    modo: isDca ? "DCA" : "SIN_DCA",
  };

  const readDate = (id) => (document.getElementById(id)?.value || "").trim();

  if (payload.modo === "DCA") {
    payload.dca = {
      aporte: Number(document.getElementById("dca-aporte")?.value || 0),
      frecuencia: document.getElementById("dca-frecuencia")?.value || "MONTHLY",
    };
    payload.inicio = readDate("fechaInicioDCA") || null;
    payload.fin = readDate("fechaFinDCA") || null;
  } else {
    payload.dca = null;
    payload.inicio = readDate("fechaCompra") || null;
    payload.fin = null;
  }

  return payload;
}

function validarPropuesta(p) {
  if (!p.ticker) {
    throw new Error("Indica un ticker.");
  }
  if (!p.importe_inicial || p.importe_inicial <= 0) {
    throw new Error("Indica un importe inicial válido.");
  }
  if (!p.horizonte_anios || p.horizonte_anios < 1) {
    throw new Error("El horizonte debe ser de al menos 1 año.");
  }

  if (p.modo === "DCA") {
    if (!p.dca || p.dca.aporte < 0) {
      throw new Error("El aporte DCA no puede ser negativo.");
    }
    const freqOk = ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"].includes(p.dca.frecuencia);
    if (!freqOk) throw new Error("Frecuencia DCA inválida.");
    if (!p.inicio || !p.fin) {
      throw new Error("Selecciona las fechas de inversión.");
    }
    if (p.inicio && p.fin && p.fin < p.inicio) {
      throw new Error("La fecha fin debe ser posterior a la inicial.");
    }
  } else {
    if (!p.inicio) {
      throw new Error("Selecciona la fecha de compra.");
    }
  }
}

function traducirPayloadLegacy(p) {
  const justificacion =
    (p.justificacion && p.justificacion.trim()) ||
    "Propuesta sin justificaci\u00f3n detallada.";
  const legacyJust = justificacion.length >= 20
    ? justificacion
    : `${justificacion} ${".".repeat(20 - justificacion.length)}`;

  return {
    ticker: p.ticker,
    importe_inicial: Math.max(0, Number(p.importe_inicial || 0)),
    horizonte_anios: Math.max(1, Math.round(Number(p.horizonte_anios || 0))),
    supuestos: {
      crecimiento_anual_pct: Number.isFinite(p.crecimiento_anual_estimado)
        ? p.crecimiento_anual_estimado
        : 0,
      margen_seguridad_pct: Number.isFinite(p.margen_seguridad_pct)
        ? p.margen_seguridad_pct
        : 0,
      roe_pct: 0,
      deuda_sobre_activos_pct: 0,
    },
    justificacion: legacyJust,
    modo: p.modo,
    dca: p.dca,
    inicio: p.inicio || null,
    fin: p.fin || null,
  };
}

async function enviarPropuesta(payload) {
  try {
    return await jsonPost("/api/propuestas", payload);
  } catch (err) {
    if (err?.status !== 404 && err?.status !== 405) throw err;
    console.warn("Fallo /api/propuestas (status %s). Probando /analisis...", err?.status);
  }
  const fallbackPayload = traducirPayloadLegacy(payload);
  return jsonPost("/analisis", fallbackPayload);
}

function mostrarToast(tipo, msg, ttl) {
  const container = document.getElementById("toast-container");
  if (!container) {
    alert(msg);
    return;
  }

  const el = document.createElement("div");
  el.className = `toast ${tipo === "ok" ? "toast-ok" : "toast-error"}`;
  el.textContent = msg;
  container.appendChild(el);

  setTimeout(() => {
    el.remove();
  }, ttl);
}

function mostrarToastOk(msg) {
  mostrarToast("ok", msg, 4000);
}

function mostrarToastError(msg) {
  mostrarToast("error", msg, 5000);
}

// === Precheck Yahoo Finance: helpers ===
function precheckYahooUrl(q) {
  const val = (q || "").trim();
  if (!val) return null;
  const isTicker = /^[A-Za-z.\-]{1,10}$/.test(val);
  return isTicker
    ? `https://finance.yahoo.com/quote/${encodeURIComponent(val.toUpperCase())}`
    : `https://finance.yahoo.com/lookup?s=${encodeURIComponent(val)}`;
}

function openYahooFor(q) {
  const url = precheckYahooUrl(q);
  if (!url) return;
  window.open(url, "_blank", "noopener");
}

function bindPrecheckModal() {
  const modal = document.getElementById("precheck-modal");
  const closeBtn = document.getElementById("precheck-close");
  const openBtn = document.getElementById("precheck-open");
  const input = document.getElementById("precheck-q");
  if (!modal || !closeBtn || !openBtn || !input) return;

  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => input.focus(), 50);

  closeBtn.addEventListener("click", () => modal.setAttribute("aria-hidden", "true"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.setAttribute("aria-hidden", "true");
  });

  openBtn.addEventListener("click", () => openYahooFor(input.value));

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") openYahooFor(input.value);
  });
}

/**
 * Enlaza el formulario de anÃ¡lisis: validaciÃ³n, envÃ­o y render de resultado.
 */
function bindAnalisisForm() {
  const btn = document.getElementById("btn-enviar-propuesta");
  if (!btn) return;

  const modoDca = document.getElementById("modo-dca");
  const modoSinDca = document.getElementById("modo-sin-dca");
  const formDca = document.getElementById("form-dca");
  const formSinDca = document.getElementById("form-sin-dca");

  const actualizarModo = () => {
    const isDca = modoDca?.checked ?? true;
    if (formDca) formDca.style.display = isDca ? "" : "none";
    if (formSinDca) formSinDca.style.display = isDca ? "none" : "";
  };

  modoDca?.addEventListener("change", actualizarModo);
  modoSinDca?.addEventListener("change", actualizarModo);
  actualizarModo();

  setupBacktestModal();

  const originalText = btn.textContent;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Enviando...";

    try {
      const payload = construirPayloadPropuesta();
      validarPropuesta(payload);

      await enviarPropuesta(payload);

      const backtestBody = {
        ticker: payload.ticker,
        importe_inicial: payload.importe_inicial,
        horizonte_anios: payload.horizonte_anios,
        modo: payload.modo,
        dca: payload.dca,
        inicio: payload.inicio,
      };
      if (payload.fin) {
        backtestBody.fin = payload.fin;
      }

      let backtestData = null;
      try {
        backtestData = await jsonPost("/market/backtest", backtestBody);
        const invested = Number(backtestData.invested || 0).toFixed(2);
        const finalValue = Number(backtestData.final_value || 0).toFixed(2);
        const pnlPct = Number(backtestData.pnl_pct || 0).toFixed(2);
        mostrarToastOk(`Backtest ${backtestData.ticker}: invertido €${invested}, valor final €${finalValue} (${pnlPct}%).`);
      } catch (err) {
        console.warn("Backtest falló:", err);
        mostrarToastError(`Backtest falló: ${err?.message || err}`);
      }

      const summaryStart = backtestBody.inicio || payload.inicio || new Date().toISOString().slice(0, 10);
      const summaryEnd = backtestBody.fin || payload.fin || new Date().toISOString().slice(0, 10);

      let summaryData = null;
      if (summaryStart) {
        try {
          summaryData = await jsonGet(
            `/market/summary?ticker=${encodeURIComponent(backtestBody.ticker)}&start=${encodeURIComponent(summaryStart)}&end=${encodeURIComponent(summaryEnd)}&adjusted=true`
          );
        } catch (summaryErr) {
          console.warn("Resumen no disponible:", summaryErr);
          mostrarToastError(`Resumen no disponible: ${summaryErr?.message || summaryErr}`);
        }
      }

      if (backtestData || summaryData) {
        const merged = {
          ...(summaryData || {}),
          ...(backtestData || {}),
        };
        merged.notes = Array.isArray(summaryData?.notes)
          ? summaryData.notes
          : Array.isArray(backtestData?.notes)
          ? backtestData.notes
          : [];

        const modalStart = merged.start || summaryStart;
        const modalEnd = merged.end || summaryEnd;

        showBacktestSummary(payload.ticker, modalStart, modalEnd, merged);
      }

      try {
        await refrescarHistorial();
      } catch (err) {
        console.warn("No se pudo refrescar el historial:", err);
      }

      if (!backtestData) {
        mostrarToastOk("✅ ¡Propuesta registrada! Estamos calculando tu resultado histórico.");
      }
    } catch (e) {
      const msg = e?.message || e || "Error desconocido";
      mostrarToastError(`No se pudo registrar la propuesta: ${msg}`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
}


async function refrescarHistorial() {
  if (!document.getElementById("his-tbody")) return;
  state.his.page = 1;
  writeParams();
  await loadHistorial();
}

async function loadHistorial() {
  const { page, per_page, ticker, desde, hasta } = state.his;
  const query = qs({ page, per_page, ticker, desde, hasta });
  const data = await jsonGet(`/analisis?${query}`);

  const arrayMode = Array.isArray(data);
  const items = arrayMode ? data : data.items;
  const total = arrayMode ? (items || []).length : data.total;
  const hasNext = arrayMode ? false : data.has_next;

  const itemsSorted = sortItems(items || [], state.his.sort, state.his.dir);

  const rows = (itemsSorted || [])
    .map((h, idx) => {
      const bt = h.backtest || null;
      const pnlValue = Number.isFinite(Number(bt?.pnl_pct))
        ? Number(bt.pnl_pct)
        : null;

      let scoreClass;
      if (pnlValue !== null) {
        if (pnlValue < 0) scoreClass = "score-low";
        else if (pnlValue < 20) scoreClass = "score-mid";
        else scoreClass = "score-high";
      } else {
        scoreClass = "score-mid";
        const sc = Number(h.puntuacion ?? 0);
        if (sc >= 80) scoreClass = "score-high";
        else if (sc < 60) scoreClass = "score-low";
      }
      const pnlChip =
        pnlValue === null
          ? ""
          : `<span class=\"${pnlValue >= 0 ? 'chip-pos' : 'chip-neg'}\">${fmtPct(pnlValue)}</span>`;

      const importeCell = [fmtEur(h.importe_inicial), pnlChip].filter(Boolean).join(" ");
      const resumenText = (h.resumen || "").replace(/\n/g, " ");
      const obsData = JSON.stringify(h.observaciones || []).replaceAll("'", "&apos;");
      const detalleDisabled = bt ? "" : 'disabled title=\"Sin datos de backtest\"';

      return `
        <tr>
          <td class=\"muted\">${fmtDate(h.timestamp)}</td>
          <td><strong>${h.ticker || ""}</strong></td>
          <td>${importeCell}</td>
          <td>${h.horizonte_anios ?? ""} años</td>
          <td><span class=\"badge ${scoreClass}\">${h.puntuacion ?? ""}</span></td>
          <td>${resumenText}</td>
          <td class=\"his-actions\">
            <button
              class=\"secondary btn-obs\"
              data-obs='${obsData}'
              type=\"button\">
              Observaciones
            </button>
            <button
              class=\"btn btn-outline his-ver\"
              data-index=\"${idx}\"
              ${detalleDisabled}
              type=\"button\">
              Ver detalle
            </button>
          </td>
        </tr>`;
    })
    .join("");

  document.getElementById("his-tbody").innerHTML =
    rows ||
    `<tr><td colspan=\"7\">
       <div class=\"empty\" style=\"padding:8px 0; color:#64748b;\">
         Todavía no hay análisis en el historial.
       </div>
     </td></tr>`;

  document.querySelectorAll("#his-tbody .btn-obs").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = JSON.parse(btn.getAttribute("data-obs") || "[]");
      openObservacionesModal(list);
    });
  });

  document.querySelectorAll("#his-tbody .his-ver").forEach((btn) => {
    if (btn.disabled) return;
    const idx = Number(btn.getAttribute("data-index"));
    if (!Number.isFinite(idx)) return;
    const item = itemsSorted[idx];
    const bt = item?.backtest;
    if (!bt) return;
    btn.addEventListener("click", () => {
      const start = bt.start || item?.inicio || (item?.timestamp || "").slice(0, 10);
      const end = bt.end || bt.hasta || bt.fin || start;
      showBacktestSummary(item?.ticker || bt.ticker, start, end, bt);
    });
  });

  const infoEl = document.getElementById("his-info");
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

  document.getElementById("his-prev").disabled = state.his.page <= 1;
  document.getElementById("his-next").disabled = !hasNext;
}

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

  //$("#his-export").addEventListener("click", exportCSV);

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
 * ValidaciÃ³n de formulario de anÃ¡lisis
 * ==========================================================================*/

/**
 * Limpia mensajes de error y estilos "invalid".
 */

/* ============================================================================
 * URL <-> Estado
 * ==========================================================================*/

/**
 * Lee parÃ¡metros desde la URL.
 * (Si quieres restaurar desde localStorage 24h, avÃ­same y lo reaÃ±adimos aquÃ­.)
 */
function readParams() {
  const p = new URLSearchParams(location.search);

  // --- Ejemplos de empresas ---
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

  // --- Ejemplos de empresas ---
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
  const filtered = (list || [])
    .filter((o) => !/roe|deuda/i.test(o?.msg || ""))
    .map((o) => ({ ...o, msg: fixMojibake(o?.msg ?? "") }));
  return (
    filtered
      .map((o) => {
        const cls = o.tipo === "ok" ? "ok" : o.tipo === "alerta" ? "alerta" : "mejora";
        return `<div class="pill ${cls}" style="display:inline-block;margin:4px 6px 0 0;">${o.msg}</div>`;
      })
      .join("") || "<span class='muted'>Sin observaciones</span>"
  );
}

// GestiÃ³n de foco para accesibilidad
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
 * OrdenaciÃ³n (click en encabezados)
 * ==========================================================================*/

function bindSorting() {
  // Ejemplos de empresas
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
  readParams();

  const hasEmpresas = Boolean(document.getElementById("emp-tbody"));
  const hasAnalisis = Boolean(document.getElementById("btn-enviar-propuesta"));
  const hasHistorial = Boolean(document.getElementById("his-tbody"));
  const hasCareer = Boolean(document.getElementById("career-app"));

  const hasBacktestModal = Boolean(document.getElementById("modalBacktest"));
  if (hasBacktestModal) {
    setupBacktestModal();
  }

  if (hasEmpresas) {
    bindEmpresas();
  }
  if (hasAnalisis) {
    bindAnalisisForm();
    // ðŸ‘‡ Mostrar y enlazar el popup de Yahoo Finance
    bindPrecheckModal();
  }
  if (hasHistorial) {
    bindHistorial();
  }
  if (hasEmpresas || hasHistorial) {
    bindSorting();
  }

  if (hasEmpresas) {
    const empQ = $("#emp-q");
    if (empQ) empQ.value = state.emp.q || "";
    const empSector = $("#emp-sector");
    if (empSector) empSector.value = state.emp.sector || "";
    const empPer = $("#emp-per-page");
    if (empPer) empPer.value = String(state.emp.per_page);

    try {
      await loadSectores();
    } catch (e) {
      console.warn("No se pudieron cargar sectores:", e);
    }

    loadEmpresas().catch((e) => alert(e.message));
  }

  if (hasHistorial) {
    const hisTicker = $("#his-ticker");
    if (hisTicker) hisTicker.value = state.his.ticker || "";
    const hisDesde = $("#his-desde");
    if (hisDesde) hisDesde.value = state.his.desde || "";
    const hisHasta = $("#his-hasta");
    if (hisHasta) hisHasta.value = state.his.hasta || "";
    const hisPer = $("#his-per-page");
    if (hisPer) hisPer.value = String(state.his.per_page);

    loadHistorial().catch((e) => alert(e.message));
  }

  if (hasHistorial) {
    const modalClose = document.getElementById("modal-close");
    if (modalClose) {
      modalClose.addEventListener("click", closeObservacionesModal);
    }

    const modalBackdrop = document.getElementById("modal");
    if (modalBackdrop) {
      modalBackdrop.addEventListener("click", (e) => {
        if (e.target.id === "modal") closeObservacionesModal();
      });
    }
  }

  if (hasEmpresas || hasHistorial) {
    window.addEventListener("popstate", async () => {
      readParams();

      if (hasEmpresas) {
        const empQEl = $("#emp-q");
        if (empQEl) empQEl.value = state.emp.q || "";
        const empSectorEl = $("#emp-sector");
        if (empSectorEl) empSectorEl.value = state.emp.sector || "";
        const empPerEl = $("#emp-per-page");
        if (empPerEl) empPerEl.value = String(state.emp.per_page);
      }

      if (hasHistorial) {
        const hisTickerEl = $("#his-ticker");
        if (hisTickerEl) hisTickerEl.value = state.his.ticker || "";
        const hisDesdeEl = $("#his-desde");
        if (hisDesdeEl) hisDesdeEl.value = state.his.desde || "";
        const hisHastaEl = $("#his-hasta");
        if (hisHastaEl) hisHastaEl.value = state.his.hasta || "";
        const hisPerEl = $("#his-per-page");
        if (hisPerEl) hisPerEl.value = String(state.his.per_page);
      }

      await Promise.all([
        hasEmpresas
          ? loadEmpresas().catch((e) => console.error(e))
          : Promise.resolve(),
        hasHistorial
          ? loadHistorial().catch((e) => console.error(e))
          : Promise.resolve(),
      ]);
    });
  }

  if (hasCareer) {
    initCareerPage();
  }
});

/* ============================================================================
 * Modo Carrera (UI)
 * ==========================================================================*/

const CAREER_MAX_ASSETS = 10;
const CAREER_STORAGE_KEY = "career:preferences";
const CAREER_PALETTE = [
  "#1d4ed8",
  "#34d399",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#14b8a6",
  "#6366f1",
  "#06b6d4",
  "#f97316",
  "#84cc16",
];

const careerState = {
  bench: state.career?.bench || "^GSPC",
  sessionId: null,
  sessionData: null,
  report: null,
  turnsForDetail: [],
  charts: { series: null, equity: null },
  latestSeriesTickers: [],
  autoplayRunning: false,
};

const CareerTurnBoundariesPlugin = {
  id: "careerTurnBoundaries",
  afterDraw(chart, args, options) {
    const boundaries = options?.boundaries || [];
    if (!boundaries.length) return;
    const xScale = chart.scales?.x;
    if (!xScale) return;
    const { top, bottom } = chart.chartArea || {};
    if (top === undefined || bottom === undefined) return;
    const ctx = chart.ctx;
    if (!ctx) return;
    const color = options.color || "#000000";
    const lineWidth = options.lineWidth || 1;
    const lineDash = options.lineDash || [];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(lineDash);
    boundaries.forEach((value) => {
      const x = xScale.getPixelForValue(value);
      if (Number.isNaN(x)) return;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    });
    ctx.restore();
  },
};

let careerTurnPluginRegistered = false;
if (typeof Chart !== "undefined") {
  Chart.register(CareerTurnBoundariesPlugin);
  careerTurnPluginRegistered = true;
}

function loadCareerPrefs() {
  try {
    const raw = localStorage.getItem(CAREER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCareerPrefs(partial) {
  const current = loadCareerPrefs();
  const next = { ...current, ...partial };
  try {
    localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn("No se pudo persistir carrera:", err);
  }
}

function initCareerPage() {
  const prefs = loadCareerPrefs();
  if (prefs.bench) {
    careerState.bench = prefs.bench;
  }
  if (Array.isArray(prefs.lastTickers)) {
    careerState.latestSeriesTickers = prefs.lastTickers;
  }
  state.career.bench = careerState.bench;

  const playerInput = document.getElementById("career-player");
  const benchInput = document.getElementById("career-bench");
  if (benchInput) benchInput.value = careerState.bench;
  if (playerInput && prefs.player) {
    playerInput.value = prefs.player;
  }

  const addAssetBtn = document.getElementById("career-add-asset");
  const closeTurnBtn = document.getElementById("career-close-turn");
  const autoplayBtn = document.getElementById("career-autoplay");
  const createBtn = document.getElementById("career-create-btn");
  const loadLastBtn = document.getElementById("career-load-last-btn");
  const loadSeriesBtn = document.getElementById("career-load-series");
  const reportBtn = document.getElementById("career-report-btn");
  const reportRefreshBtn = document.getElementById("career-report-refresh");
  const exportPngBtn = document.getElementById("career-export-png");
  const rankingSubmitBtn = document.getElementById("career-ranking-submit");
  const rankingRefreshBtn = document.getElementById("career-ranking-refresh");
  const shareBtn = document.getElementById("career-share-btn");
  const periodRandomEl = document.getElementById("career-period-mode-random");
  const periodManualEl = document.getElementById("career-period-mode-manual");
  const periodManualFields = document.getElementById("career-period-manual-fields");

  createBtn?.addEventListener("click", handleCareerCreate);
  loadLastBtn?.addEventListener("click", handleCareerLoadLast);
  addAssetBtn?.addEventListener("click", () => addCareerAllocRow());
  closeTurnBtn?.addEventListener("click", handleCareerCloseTurn);
  if (autoplayBtn) {
    autoplayBtn.addEventListener("click", () => {
      if (careerState.autoplayRunning) return;
      handleCareerAutoPlay();
    });
  }
  loadSeriesBtn?.addEventListener("click", () => loadCareerSeries());
  reportBtn?.addEventListener("click", () => renderCareerReport({ includeSeries: true }));
  reportRefreshBtn?.addEventListener("click", () => renderCareerReport({ includeSeries: true, force: true }));
  exportPngBtn?.addEventListener("click", exportCareerPng);
  rankingSubmitBtn?.addEventListener("click", submitCareerRanking);
  rankingRefreshBtn?.addEventListener("click", refreshCareerRanking);
  shareBtn?.addEventListener("click", fetchCareerShare);

  const consentChk = document.getElementById("career-ranking-consent");
  consentChk?.addEventListener("change", () => {
    if (!careerState.report) {
      rankingSubmitBtn.disabled = true;
      return;
    }
    rankingSubmitBtn.disabled = !consentChk.checked;
  });

  benchInput?.addEventListener("change", () => {
    careerState.bench = benchInput.value.trim() || "^GSPC";
    state.career.bench = careerState.bench;
    saveCareerPrefs({ bench: careerState.bench });
  });

  const updateCareerPeriodModeUI = () => {
    if (periodManualEl?.checked) {
      periodManualFields?.classList.remove("hidden");
    } else {
      periodManualFields?.classList.add("hidden");
    }
  };
  periodRandomEl?.addEventListener("change", updateCareerPeriodModeUI);
  periodManualEl?.addEventListener("change", updateCareerPeriodModeUI);
  updateCareerPeriodModeUI();

  const allocList = document.getElementById("career-alloc-list");
  allocList?.addEventListener("input", () => {
    rememberCareerAllocTickers();
    updateCareerAllocSummary();
  });
  allocList?.addEventListener("click", (ev) => {
    if (ev.target.closest(".career-remove-asset")) {
      ev.target.closest(".alloc-row")?.remove();
      ensureCareerAllocRows();
      rememberCareerAllocTickers();
      updateCareerAllocSummary();
    }
  });

  const exportButtons = document.querySelectorAll(".career-export-buttons [data-export]");
  exportButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-export");
      if (!type) return;
      exportCareerCsv(type);
    });
  });

  const turnsBody = document.getElementById("career-turns-body");
  turnsBody?.addEventListener("click", (ev) => {
    const target = ev.target instanceof Element ? ev.target : null;
    const btn = target?.closest("[data-turn-detail]");
    if (!btn) return;
    const turnN = Number(btn.getAttribute("data-turn-detail"));
    const turn =
      (careerState.turnsForDetail || []).find(
        (item) => (item?.n ?? item?.turn_n ?? item?.turn) === turnN
      ) || null;
    if (turn) {
      showCareerTurnBreakdown(turn);
    }
  });

  if (loadLastBtn) {
    const prefs = loadCareerPrefs();
    loadLastBtn.disabled = !prefs.lastSessionId;
  }

  ensureCareerAllocRows();
  updateCareerAllocSummary();
  refreshCareerRanking();

  const storedSessionId = prefs.lastSessionId;
  if (storedSessionId) {
    handleCareerLoadSession(storedSessionId, { silent: true }).catch((err) => {
      console.warn("No se pudo recuperar la sesión previa:", err);
    });
  }
}

function ensureCareerAllocRows() {
  const list = document.getElementById("career-alloc-list");
  if (!list) return;
  const rows = Array.from(list.querySelectorAll(".alloc-row"));
  if (rows.length === 0) {
    for (let i = 0; i < 3; i++) addCareerAllocRow();
  }
}

function addCareerAllocRow(prefill) {
  const list = document.getElementById("career-alloc-list");
  if (!list) return;
  const rows = list.querySelectorAll(".alloc-row").length;
  if (rows >= CAREER_MAX_ASSETS) {
    mostrarToastError("La cartera admite como máximo 10 activos.");
    return;
  }
  const row = document.createElement("div");
  row.className = "alloc-row";
  row.innerHTML = `
    <input type="text" class="career-alloc-ticker" placeholder="Ticker" maxlength="15" value="${prefill?.ticker || ""}" />
    <input type="number" class="career-alloc-weight" placeholder="Peso" step="0.01" min="0" max="1" value="${prefill?.weight ?? ""}" />
    <button type="button" class="btn btn-ghost btn--xs career-remove-asset" aria-label="Quitar">×</button>
  `;
  list.appendChild(row);
}

function normalizeWeightNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return 0;
  return Number(num.toFixed(6));
}

function roundWeights(rawWeights, normalized) {
  const result = new Array(rawWeights.length).fill(0);
  if (!normalized) {
    rawWeights.forEach((weight, idx) => {
      const normalizedWeight = normalizeWeightNumber(weight);
      if (normalizedWeight !== null) {
        result[idx] = normalizedWeight;
      }
    });
    return result;
  }

  const positive = rawWeights
    .map((weight, idx) => ({ idx, weight }))
    .filter((item) => Number.isFinite(item.weight) && item.weight > 0);
  if (!positive.length) return result;

  const scale = 1_000_000;
  const targetTotal = Math.round(
    positive.reduce((acc, item) => acc + item.weight, 0) * scale
  );
  const ints = positive.map((item) => {
    const scaled = item.weight * scale;
    const base = Math.floor(scaled);
    return { idx: item.idx, base, frac: scaled - base };
  });
  let currentSum = ints.reduce((acc, item) => acc + item.base, 0);
  let delta = targetTotal - currentSum;

  if (delta > 0) {
    const sortedDesc = [...ints].sort((a, b) => b.frac - a.frac);
    for (const entry of sortedDesc) {
      if (delta <= 0) break;
      if (entry.frac <= 0) continue;
      entry.base += 1;
      delta -= 1;
    }
  } else if (delta < 0) {
    const sortedAsc = [...ints].sort((a, b) => a.frac - b.frac);
    for (const entry of sortedAsc) {
      if (delta >= 0) break;
      if (entry.base <= 0) continue;
      entry.base -= 1;
      delta += 1;
    }
  }

  ints.forEach((entry) => {
    result[entry.idx] = entry.base / scale;
  });
  return result;
}

function resetCareerAllocRows(prefillList) {
  const list = document.getElementById("career-alloc-list");
  if (!list) return;
  list.innerHTML = "";
  const items = Array.isArray(prefillList) ? prefillList : [];
  items.forEach((entry) => {
    if (entry && typeof entry === "object" && entry.ticker) {
      const ticker = String(entry.ticker || "").trim().toUpperCase();
      const normalizedWeight = normalizeWeightNumber(entry.weight);
      addCareerAllocRow({
        ticker,
        weight: normalizedWeight !== null ? normalizedWeight : "",
      });
    } else if (entry) {
      addCareerAllocRow({ ticker: String(entry).trim().toUpperCase() });
    }
  });
  ensureCareerAllocRows();
  updateCareerAllocSummary();
}

function collectCareerAlloc() {
  const list = document.getElementById("career-alloc-list");
  if (!list) return [];
  return Array.from(list.querySelectorAll(".alloc-row"))
    .map((row) => {
      const ticker = row.querySelector(".career-alloc-ticker")?.value?.trim()?.toUpperCase();
      const weightInput = row.querySelector(".career-alloc-weight");
      const weight = weightInput?.value ? Number(weightInput.value) : NaN;
      return { ticker, weight };
    })
    .filter((item) => item.ticker && Number.isFinite(item.weight) && item.weight > 0);
}

function updateCareerAllocSummary() {
  const summary = document.getElementById("career-alloc-summary");
  if (!summary) return;
  const alloc = collectCareerAlloc();
  const total = alloc.reduce((acc, item) => acc + item.weight, 0);
  const uniqueTickers = new Set(alloc.map((item) => item.ticker));
  summary.textContent = `Peso total: ${total.toFixed(2)} · Activos: ${uniqueTickers.size}`;
  if (total > 1.0001 || uniqueTickers.size > CAREER_MAX_ASSETS) {
    summary.classList.add("text-neg");
  } else {
    summary.classList.remove("text-neg");
  }
}

function rememberCareerAllocTickers() {
  const tickers = collectCareerAlloc().map((item) => item.ticker);
  careerState.latestSeriesTickers = tickers;
  saveCareerPrefs({ lastTickers: tickers });
}

function setCareerTurnActionsEnabled(enabled) {
  const closeBtn = document.getElementById("career-close-turn");
  const autoBtn = document.getElementById("career-autoplay");
  const disabled = !enabled;
  if (closeBtn) closeBtn.disabled = disabled;
  if (autoBtn) autoBtn.disabled = disabled;
}

function buildNextAllocFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return [];

  const suggested = Array.isArray(snapshot.alloc_next_suggested)
    ? snapshot.alloc_next_suggested
        .map((item) => {
          const ticker = item?.ticker ? String(item.ticker).trim().toUpperCase() : "";
          if (!ticker) return null;
          const weight = normalizeWeightNumber(item?.weight);
          return { ticker, weight: weight ?? 0 };
        })
        .filter(Boolean)
    : [];
  if (suggested.length) {
    return suggested;
  }

  const alloc = Array.isArray(snapshot.alloc) ? snapshot.alloc : [];
  if (!alloc.length) return [];

  const returnsFinal = snapshot.ret_by_ticker_final || {};
  const rows = alloc.map((item) => {
    const ticker = item?.ticker ? String(item.ticker).trim().toUpperCase() : "";
    const baseWeight = normalizeWeightNumber(item?.weight) ?? 0;
    const rawReturn = Number(
      returnsFinal[item?.ticker] ?? returnsFinal[ticker] ?? 0
    );
    const ret = Number.isFinite(rawReturn) ? rawReturn : 0;
    const growthCandidate = baseWeight > 0 ? baseWeight * (1 + ret) : 0;
    const growth =
      Number.isFinite(growthCandidate) && growthCandidate > 0 ? growthCandidate : 0;
    return { ticker, baseWeight, ret, growth };
  });

  const rawWeights = rows.map(() => 0);
  let normalized = false;
  const denominator = rows.reduce((acc, row) => acc + row.growth, 0);

  if (Number.isFinite(denominator) && denominator > 0) {
    normalized = true;
    rows.forEach((row, idx) => {
      if (row.growth > 0) {
        rawWeights[idx] = row.growth / denominator;
      }
    });
  } else {
    const survivorsIdx = rows
      .map((row, idx) => (row.ret > -1 && row.baseWeight > 0 ? idx : -1))
      .filter((idx) => idx >= 0);
    if (survivorsIdx.length) {
      normalized = true;
      const equal = 1 / survivorsIdx.length;
      survivorsIdx.forEach((idx) => {
        rawWeights[idx] = equal;
      });
    } else {
      rows.forEach((row, idx) => {
        rawWeights[idx] = row.baseWeight;
      });
    }
  }

  const roundedWeights = roundWeights(rawWeights, normalized);
  let result = rows
    .map((row, idx) => {
      if (!row.ticker) return null;
      const weight = normalizeWeightNumber(roundedWeights[idx]);
      return {
        ticker: row.ticker,
        weight: weight ?? 0,
      };
    })
    .filter(Boolean);

  const total = result.reduce(
    (acc, item) =>
      acc + (Number.isFinite(item.weight) ? item.weight : 0),
    0
  );
  if (!Number.isFinite(total) || total <= 0) {
    const fallbackRaw = rows.map((row) => (row.ticker ? 1 : 0));
    const activeCount = fallbackRaw.filter(Boolean).length;
    if (!activeCount) {
      return [];
    }
    const equalWeight = 1 / activeCount;
    const equalRaw = rows.map((row) => (row.ticker ? equalWeight : 0));
    const roundedEqual = roundWeights(equalRaw, true);
    result = rows
      .map((row, idx) => {
        if (!row.ticker) return null;
        const weight = normalizeWeightNumber(roundedEqual[idx]);
        return {
          ticker: row.ticker,
          weight: weight ?? 0,
        };
      })
      .filter(Boolean);
  }

  return result;
}

function handleCareerCreate() {
  const player = document.getElementById("career-player")?.value?.trim() || "";
  const difficulty = document.getElementById("career-difficulty")?.value || "intermedio";
  const capital = Number(document.getElementById("career-capital")?.value || 50000);
  const bench = document.getElementById("career-bench")?.value?.trim() || "^GSPC";
  const periodModeInput = document.querySelector('input[name="career-period-mode"]:checked');
  const periodMode = periodModeInput?.value === "manual" ? "manual" : "random";
  let periodStart = "";
  let periodEnd = "";
  if (periodMode === "manual") {
    periodStart = document.getElementById("career-period-start")?.value || "";
    periodEnd = document.getElementById("career-period-end")?.value || "";
    if (!periodStart || !periodEnd) {
      mostrarToastError("Selecciona una fecha de inicio y una fecha de fin para el periodo.");
      return;
    }
    if (periodStart > periodEnd) {
      mostrarToastError("La fecha de inicio debe ser anterior o igual a la de fin.");
      return;
    }
  }

  if (!difficulty) {
    mostrarToastError("Selecciona dificultad.");
    return;
  }
  if (!Number.isFinite(capital) || capital <= 0) {
    mostrarToastError("Capital inválido.");
    return;
  }

  const payload = {
    player,
    difficulty,
    universe: [],
    capital,
    period_mode: periodMode,
  };
  if (periodMode === "manual") {
    payload.period_start = periodStart;
    payload.period_end = periodEnd;
  }

  const btn = document.getElementById("career-create-btn");
  careerSetLoading(btn, true);
  jsonPost("/api/career/session", payload)
    .then((data) => {
      mostrarToastOk("Sesión creada.");
      if (player) saveCareerPrefs({ player });
      careerState.bench = bench;
      state.career.bench = bench;
      saveCareerPrefs({ bench, lastSessionId: data.session_id });
      handleCareerLoadSession(data.session_id);
    })
    .catch((err) => {
      mostrarToastError(err?.message || "No se pudo crear la sesión.");
    })
    .finally(() => careerSetLoading(btn, false));
}

function handleCareerLoadLast() {
  const prefs = loadCareerPrefs();
  if (!prefs.lastSessionId) {
    mostrarToastError("No hay sesión previa almacenada.");
    return;
  }
  handleCareerLoadSession(prefs.lastSessionId).catch((err) => {
    mostrarToastError(err?.message || "No se pudo cargar la sesión.");
  });
}

async function handleCareerLoadSession(sessionId, opts = {}) {
  const data = await jsonGet(`/api/career/session/${encodeURIComponent(sessionId)}`);
  careerState.sessionId = sessionId;
  careerState.sessionData = data.session;
  saveCareerPrefs({ lastSessionId: sessionId });
  renderCareerSession(data.session);
  updateCareerAllocSummary();
  if (!opts.silent) {
    mostrarToastOk("Sesión cargada.");
  }
  return data.session;
}

function renderCareerSession(session) {
  const card = document.getElementById("career-session-card");
  const seriesCard = document.getElementById("career-series-card");
  if (card) card.hidden = false;
  if (seriesCard) seriesCard.hidden = false;
  if (careerState.charts.equity) {
    careerState.charts.equity.destroy();
    careerState.charts.equity = null;
  }
  if (careerState.charts.series) {
    careerState.charts.series.destroy();
    careerState.charts.series = null;
  }
  const shareOut = document.getElementById("career-share-output");
  if (shareOut) {
    shareOut.textContent = "Genera el informe para habilitar el share.";
  }
  careerState.report = null;
  const rankingSubmit = document.getElementById("career-ranking-submit");
  if (rankingSubmit) rankingSubmit.disabled = true;

  document.getElementById("career-session-id").textContent = session.session_id;
  const period = session.period || {};
  document.getElementById("career-session-range").textContent = `Periodo: ${period.start || "—"} → ${period.end || "—"}`;
  document.getElementById("career-session-capital").textContent = fmtEur(session.capital_current);
  const loadLastBtn = document.getElementById("career-load-last-btn");
  if (loadLastBtn) loadLastBtn.disabled = false;

  const pendingTurn = (session.turns || []).find((t) => t.status === "pending");
  const turnLabel = pendingTurn
    ? `${pendingTurn.start} → ${pendingTurn.end}`
    : "Sesión completada";
  document.getElementById("career-session-turn").textContent = turnLabel;

  const closeBtn = document.getElementById("career-close-turn");
  if (closeBtn) closeBtn.disabled = !pendingTurn;

  updateCareerTurnsTable(session.completed_turns || []);
  updateCareerSeriesSelectors(session);

  const prefs = loadCareerPrefs();
  const decisions = Array.isArray(session.decisions) ? session.decisions : [];
  const lastDecision = decisions.length ? decisions[decisions.length - 1] : null;
  const lastAlloc = Array.isArray(lastDecision?.alloc)
    ? lastDecision.alloc
        .map((item) => {
          const ticker = item?.ticker ? String(item.ticker).trim().toUpperCase() : "";
          if (!ticker) return null;
          const weightNum = Number(item?.weight);
          const weight = Number.isFinite(weightNum) ? weightNum : 0;
          return { ticker, weight };
        })
        .filter(Boolean)
    : [];

  if (lastAlloc.length) {
    resetCareerAllocRows(lastAlloc);
  } else if (prefs.lastTickers?.length) {
    resetCareerAllocRows(prefs.lastTickers);
  } else {
    resetCareerAllocRows((session.universe || []).slice(0, 3));
  }
  document.getElementById("career-report-card").hidden = false;
}

function updateCareerTurnsTable(turns) {
  const body = document.getElementById("career-turns-body");
  if (!body) return;
  const safeTurns = Array.isArray(turns) ? turns : [];
  careerState.turnsForDetail = safeTurns;
  if (!safeTurns.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty">Aún no hay turnos cerrados.</td></tr>`;
    return;
  }
  body.innerHTML = safeTurns
    .map((turn) => {
      const range = turn.range || {};
      const turnNumber = turn.n ?? turn.turn_n ?? turn.turn ?? ND;
      const turnReturn = Number(turn.turn_return || 0);
      const returnClass = Number.isFinite(turnReturn) && turnReturn < 0 ? "text-neg" : "text-pos";
      return `
        <tr>
          <td class="turn-number">${turnNumber}</td>
          <td>${range.start || "—"} → ${range.end || "—"}</td>
          <td class="${returnClass} turn-return">${fmtPct((turnReturn || 0) * 100)}</td>
          <td>${fmtEur(turn.portfolio_value)}</td>
          <td>${turn.use_dca ? "Sí" : "No"}</td>
          <td class="action-cell">
            <button class="btn btn-ghost btn-compact career-turn-detail" type="button" data-turn-detail="${turnNumber}">
              Ver desglose
            </button>
          </td>
        </tr>`;
    })
    .join("");
}

function showCareerTurnBreakdown(turn) {
  const turnNumber = turn?.n ?? turn?.turn_n ?? turn?.turn ?? ND;
  const range = turn?.range || {};
  const overallReturn = Number(turn?.turn_return || 0);
  const returnsMap = turn?.ret_by_ticker_final || turn?.ret_by_ticker || null;
  const alloc = Array.isArray(turn?.alloc) ? turn.alloc : [];

  const modal = createCareerModal({
    id: "career-turn-breakdown",
    title: `Turno ${turnNumber}`,
    contentClass: "career-turn-modal",
  });

  const meta = document.createElement("div");
  meta.className = "career-turn-breakdown-header";
  meta.innerHTML = `
    <div>
      <p class="muted">Rango</p>
      <strong>${range.start || "—"} → ${range.end || "—"}</strong>
    </div>
    <div>
      <p class="muted">Retorno del turno</p>
      <strong class="${overallReturn < 0 ? "text-neg" : "text-pos"}">${fmtPct(
    overallReturn * 100
  )}</strong>
    </div>
  `;
  modal.body.appendChild(meta);

  const rows =
    alloc
      .map((item) => {
        const ticker = String(item?.ticker || "").toUpperCase();
        const weight = Number(item?.weight ?? 0);
        if (!ticker || !Number.isFinite(weight) || weight <= 0) return null;
        const tickerRetRaw =
          returnsMap?.[item?.ticker] ??
          returnsMap?.[ticker] ??
          (item?.ticker ? returnsMap?.[String(item.ticker).toUpperCase()] : undefined);
        const tickerReturn = Number(tickerRetRaw ?? NaN);
        if (!Number.isFinite(tickerReturn)) return null;
        const contribution = weight * tickerReturn;
        const share =
          Number.isFinite(overallReturn) && Math.abs(overallReturn) > 1e-9
            ? contribution / overallReturn
            : null;
        return { ticker, weight, tickerReturn, contribution, share };
      })
      .filter(Boolean)
      .sort((a, b) => b.contribution - a.contribution) || [];

  if (!rows.length) {
    const message = document.createElement("p");
    message.className = "modal__message";
    message.textContent = "No hay datos suficientes para desglosar este turno.";
    modal.body.appendChild(message);
  } else {
    const table = document.createElement("table");
    table.className = "table career-breakdown-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Peso inicio</th>
          <th>Retorno ticker</th>
          <th>Contribución</th>
          <th>Aporte vs turno</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((row) => {
            const contributionPct = row.contribution * 100;
            const sharePct = row.share !== null && row.share !== undefined ? row.share * 100 : null;
            const contributionClass = contributionPct < 0 ? "text-neg" : "text-pos";
            return `
              <tr>
                <td>${row.ticker}</td>
                <td>${fmtPct(row.weight * 100)}</td>
                <td class="${row.tickerReturn < 0 ? "text-neg" : "text-pos"}">${fmtSignedPct(
              row.tickerReturn * 100
            )}</td>
                <td class="${contributionClass}">${fmtSignedPct(contributionPct)}</td>
                <td>${sharePct === null ? ND : fmtSignedPct(sharePct)}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    `;
    modal.body.appendChild(table);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-primary";
  closeBtn.textContent = "Cerrar";
  modal.footer.appendChild(closeBtn);
  closeBtn.addEventListener("click", () => modal.close());

  requestAnimationFrame(() => closeBtn.focus({ preventScroll: true }));
}

function updateCareerSeriesSelectors(session) {
  const container = document.getElementById("career-series-tickers");
  if (!container) return;
  const universe = new Set(session.universe || []);
  (session.decisions || []).forEach((decision) => {
    (decision.alloc || []).forEach((item) => {
      if (item.ticker) universe.add(String(item.ticker).toUpperCase());
    });
  });
  const tickers = Array.from(universe).sort();
  if (!tickers.length) {
    container.innerHTML = `<span class="muted">Añade activos para ver series.</span>`;
    return;
  }
  const saved = new Set(careerState.latestSeriesTickers || tickers.slice(0, 3));
  container.innerHTML = tickers
    .map((ticker) => {
      const checked = saved.has(ticker) ? "checked" : "";
      return `
        <label class="checkbox-inline">
          <input type="checkbox" class="career-series-option" value="${ticker}" ${checked} />
          <span>${ticker}</span>
        </label>`;
    })
    .join("");
}

function handleCareerCloseTurn() {
  if (!careerState.sessionId) {
    mostrarToastError("Crea o carga una sesión primero.");
    return;
  }
  const alloc = collectCareerAlloc();
  const unique = new Set(alloc.map((item) => item.ticker));
  const totalWeight = alloc.reduce((acc, item) => acc + item.weight, 0);
  if (!alloc.length) {
    mostrarToastError("Añade al menos un activo con peso.");
    return;
  }
    if (unique.size > CAREER_MAX_ASSETS) {
      mostrarToastError("La cartera admite como máximo 10 activos.");
      return;
    }
    if (totalWeight > 1.0001) {
    mostrarToastError("La suma de pesos no puede superar 1.0.");
    return;
  }

  const pendingTurn = (careerState.sessionData?.turns || []).find((t) => t.status === "pending");
  if (!pendingTurn) {
    mostrarToastError("No hay turnos pendientes.");
    return;
  }

  const payload = {
    session_id: careerState.sessionId,
    turn_n: pendingTurn.n,
    alloc,
    use_dca: Boolean(document.getElementById("career-use-dca")?.checked),
  };

  const btn = document.getElementById("career-close-turn");
  careerSetLoading(btn, true);
  jsonPost("/api/career/turn", payload)
    .then((data) => {
      if (data && data.ok === false && data.error_code === "NO_HISTORICAL_DATA") {
        const invalid = Array.isArray(data.invalid_tickers) ? data.invalid_tickers : [];
        const suffix = invalid.length ? ` (Sin datos historicos: ${invalid.join(", ")})` : "";
        const message =
          data.message ||
          "No se encontraron datos historicos validos para estos tickers. Ajusta la cartera e intenta de nuevo.";
        mostrarToastError(`${message}${suffix}`.trim());
        return;
      }
      mostrarToastOk("Turno cerrado.");
      const snapshot = data?.snapshot;
      const nextAlloc = buildNextAllocFromSnapshot(snapshot);
      showCareerEventsModal(snapshot);
      handleCareerLoadSession(careerState.sessionId).then(() => {
        if (nextAlloc.length) {
          resetCareerAllocRows(nextAlloc);
          updateCareerAllocSummary();
          rememberCareerAllocTickers();
        }
      renderCareerReport({ includeSeries: false });
      loadCareerSeries();
    });
    return data;
  })
    .catch((err) => {
      mostrarToastError(err?.message || "No se pudo cerrar el turno.");
    })
    .finally(() => careerSetLoading(btn, false));
}

async function handleCareerAutoPlay() {
  if (!careerState.sessionId) {
    mostrarToastError("Crea o carga una sesión primero.");
    return;
  }
  const pendingTurn = (careerState.sessionData?.turns || []).find((t) => t.status === "pending");
  if (!pendingTurn) {
    mostrarToastError("No hay turnos pendientes.");
    return;
  }
  const turnsLeft = (careerState.sessionData?.turns || []).filter((t) => t.status === "pending").length;
  if (turnsLeft > 1) {
    const ok = await careerConfirm(
      `Se van a cerrar automáticamente los ${turnsLeft} turnos pendientes usando la asignación actual y el drift. ¿Continuar?`
    );
    if (!ok) return;
  }

  careerState.autoplayRunning = true;
  setCareerTurnActionsEnabled(false);

  try {
    const useDca = Boolean(document.getElementById("career-use-dca")?.checked);
    while (true) {
      const currentPending = (careerState.sessionData?.turns || []).find((t) => t.status === "pending");
      if (!currentPending) break;

      const alloc = collectCareerAlloc();
      const unique = new Set(alloc.map((item) => item.ticker));
      const totalWeight = alloc.reduce((acc, item) => acc + item.weight, 0);

      if (!alloc.length) {
        mostrarToastError("Añade al menos un activo con peso.");
        break;
      }
      if (unique.size > CAREER_MAX_ASSETS) {
        mostrarToastError("La cartera admite como máximo 10 activos.");
        break;
      }
      if (totalWeight > 1.0001) {
        mostrarToastError("La suma de pesos no puede superar 1.0.");
        break;
      }

      const payload = {
        session_id: careerState.sessionId,
        turn_n: currentPending.n,
        alloc,
        use_dca: useDca,
      };
      const data = await jsonPost("/api/career/turn", payload);

      if (data && data.ok === false && data.error_code === "NO_HISTORICAL_DATA") {
        const invalid = Array.isArray(data.invalid_tickers) ? data.invalid_tickers : [];
        const suffix = invalid.length ? ` (Sin datos historicos: ${invalid.join(", ")})` : "";
        const message =
          data.message ||
          "No se encontraron datos historicos validos para estos tickers. Ajusta la cartera e intenta de nuevo.";
        mostrarToastError(`${message}${suffix}`.trim());
        break;
      }

      const snapshot = data?.snapshot;
      const nextAlloc = buildNextAllocFromSnapshot(snapshot);
      if (nextAlloc && nextAlloc.length) {
        resetCareerAllocRows(nextAlloc);
        updateCareerAllocSummary();
        rememberCareerAllocTickers();
      }

      await handleCareerLoadSession(careerState.sessionId, { silent: true });
    }

    await renderCareerReport({ includeSeries: true });
    await loadCareerSeries();
    mostrarToastOk("Simulación automática de turnos completada.");
  } catch (err) {
    console.error("Error en autoplay de carrera:", err);
    mostrarToastError(err?.message || "No se pudo completar la simulación automática.");
  } finally {
    careerState.autoplayRunning = false;
    setCareerTurnActionsEnabled(true);
  }
}

function loadCareerSeries() {
  if (!careerState.sessionId) {
    mostrarToastError("Crea o carga una sesión primero.");
    return;
  }
  const selected = Array.from(
    document.querySelectorAll(".career-series-option:checked")
  ).map((input) => input.value);
  if (!selected.length) {
    mostrarToastError("Selecciona al menos un ticker para graficar.");
    return;
  }
  careerState.latestSeriesTickers = selected;
  saveCareerPrefs({ lastTickers: selected });
  const base = `/api/career/series/${encodeURIComponent(careerState.sessionId)}`;
  const url = `${base}?${qs({ tickers: selected.join(",") })}`;

  const emptyMsg = document.getElementById("career-series-empty");
  if (emptyMsg) emptyMsg.textContent = "Cargando series...";

  jsonGet(url)
    .then((data) => {
      renderCareerSeriesChart(data);
    })
    .catch((err) => {
      mostrarToastError(err?.message || "No se pudieron cargar las series.");
    })
    .finally(() => {
      if (emptyMsg) emptyMsg.textContent = "";
    });
}

function renderCareerSeriesChart(payload) {
  const canvas = document.getElementById("career-series-chart");
  if (!canvas || typeof Chart === "undefined") return;
  const emptyMsg = document.getElementById("career-series-empty");
  const labels = new Set();
  const datasets = [];
  let colorIndex = 0;

  Object.entries(payload.series || {}).forEach(([ticker, series]) => {
    const entries = series || [];
    entries.forEach((point) => labels.add(point[0]));
  });

  const labelArray = Array.from(labels).sort();
  const turnBoundaries = mapTurnEndsToNearestLabels(
    careerState.report?.turns || [],
    labelArray
  );

  Object.entries(payload.series || {}).forEach(([ticker, series]) => {
    const entries = series || [];
    const map = new Map(entries.map((item) => [item[0], item[1]]));
    const data = labelArray.map((label) => (map.has(label) ? Number(map.get(label)) : null));
    datasets.push({
      label: ticker,
      data,
      borderColor: CAREER_PALETTE[colorIndex % CAREER_PALETTE.length],
      tension: 0.15,
      spanGaps: true,
    });
    colorIndex += 1;
  });

  if (!careerState.charts.series) {
    careerState.charts.series = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: labelArray, datasets },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue}` } },
          careerTurnBoundaries: {
            boundaries: turnBoundaries,
            color: "#000000",
            lineWidth: 1,
          },
        },
        scales: {
          y: { title: { display: true, text: "Base 100" } },
        },
      },
    });
  } else {
    const chart = careerState.charts.series;
    chart.data.labels = labelArray;
    chart.data.datasets = datasets;
    if (!chart.options.plugins) {
      chart.options.plugins = {};
    }
    chart.options.plugins.careerTurnBoundaries = {
      boundaries: turnBoundaries,
      color: "#000000",
      lineWidth: 1,
    };
    chart.update();
  }

  if (emptyMsg) {
    emptyMsg.textContent = datasets.length ? "" : "Sin datos para mostrar.";
  }
}

function renderCareerReport(options = {}) {
  if (!careerState.sessionId) {
    mostrarToastError("Crea o selecciona una sesión.");
    return;
  }
  const includeSeries = options.includeSeries === true;
  const bench = careerState.bench || "^GSPC";
  const url = `/api/career/report/${encodeURIComponent(careerState.sessionId)}?${qs({
    bench,
    include_series: includeSeries ? "true" : "false",
  })}`;
  const btn = document.getElementById("career-report-btn");
  careerSetLoading(btn, true);
  jsonGet(url)
    .then((data) => {
      careerState.report = data;
      renderCareerReportPanels(data, includeSeries);
      document.getElementById("career-ranking-submit").disabled = !document.getElementById("career-ranking-consent")?.checked;
      mostrarToastOk("Informe actualizado.");
    })
    .catch((err) => {
      mostrarToastError(err?.message || "No se pudo generar el informe.");
    })
    .finally(() => careerSetLoading(btn, false));
}

function renderCareerReportPanels(report, hasSeries) {
  const starsEl = document.getElementById("career-score-stars");
  const valueEl = document.getElementById("career-score-value");
  const notesEl = document.getElementById("career-score-notes");

  const score = report.score || {};
  if (starsEl) starsEl.textContent = `${score.stars ?? "—"}★`;
  if (valueEl) valueEl.textContent = `${score.value ?? "—"} / 10`;
  if (notesEl) notesEl.textContent = score.notes || "Genera el informe para ver tu puntuación.";

  renderCareerMetrics(report);
  renderCareerWarnings(report.warnings || []);
  if (Array.isArray(report.turns)) {
    updateCareerTurnsTable(report.turns);
  }

  if (hasSeries && report.portfolio_equity?.series?.length) {
    renderCareerEquityChart(report, careerState.bench);
  } else if (hasSeries && careerState.charts.equity) {
    careerState.charts.equity.destroy();
    careerState.charts.equity = null;
  }
}

function renderCareerMetrics(report) {
  const portfolio = report.portfolio_equity?.metrics || {};
  const benchmark = report.benchmark?.metrics || {};
  const tracking = report.tracking || {};

  const mapMetrics = (target, metrics) => {
    const el = document.getElementById(target);
    if (!el) return;
    el.innerHTML = `
      <li>CAGR: ${fmtPct((metrics.CAGR || 0) * 100)}</li>
      <li>Volatilidad anual: ${fmtPct((metrics.vol_annual || 0) * 100)}</li>
      <li>Drawdown: ${fmtPct((metrics.max_drawdown || 0) * 100)}</li>
      <li>Retorno total: ${fmtPct((metrics.total_return || 0) * 100)}</li>
    `;
  };

  mapMetrics("career-metrics-portfolio", portfolio);
  mapMetrics("career-metrics-benchmark", benchmark);

  const trackingEl = document.getElementById("career-metrics-tracking");
  if (trackingEl) {
    trackingEl.innerHTML = `
      <li>Active return: ${fmtPct((tracking.active_return || 0) * 100)}</li>
      <li>Tracking error: ${fmtPct((tracking.tracking_error || 0) * 100)}</li>
      <li>Information ratio: ${
        tracking.information_ratio !== null && tracking.information_ratio !== undefined
          ? tracking.information_ratio.toFixed(2)
          : ND
      }</li>
    `;
  }
}

function renderCareerWarnings(warnings) {
  const container = document.getElementById("career-warnings-list");
  if (!container) return;
  if (!warnings.length) {
    container.innerHTML = `<span class="muted">Sin advertencias.</span>`;
    return;
  }
  container.innerHTML = warnings
    .map((w) => `<span class="warning-chip">${w}</span>`)
    .join("");
}

function renderCareerTheoretical() {
  // Bloque retirado de la interfaz; se deja la función como no-op por compatibilidad.
  return;
}

function renderCareerEquityChart(report, benchTicker) {
  if (typeof Chart === "undefined") return;
  if (!careerTurnPluginRegistered) {
    Chart.register(CareerTurnBoundariesPlugin);
    careerTurnPluginRegistered = true;
  }
  const canvas = document.getElementById("career-equity-chart");
  if (!canvas) return;
  const equitySeries = report.portfolio_equity?.series || [];
  const benchSeries = report.benchmark?.series || [];
  const labels = Array.from(
    new Set([...equitySeries, ...benchSeries].map((item) => item[0]))
  ).sort();
  const turnBoundaries = (report.turns || [])
    .map((turn) => turn?.range?.end || null)
    .filter((end) => end && labels.includes(end));
  const toMap = (series) => {
    const map = new Map(series.map((item) => [item[0], item[1]]));
    return labels.map((label) => (map.has(label) ? Number(map.get(label)) : null));
  };

  const datasets = [
    {
      label: "Portfolio",
      data: toMap(equitySeries),
      borderColor: CAREER_PALETTE[0],
      tension: 0.12,
      spanGaps: true,
    },
  ];
  if (benchSeries.length) {
    datasets.push({
      label: benchTicker || "Benchmark",
      data: toMap(benchSeries),
      borderColor: CAREER_PALETTE[1],
      borderDash: [6, 4],
      tension: 0.12,
      spanGaps: true,
    });
  }

  if (!careerState.charts.equity) {
    careerState.charts.equity = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          careerTurnBoundaries: {
            boundaries: turnBoundaries,
            color: "#000000",
            lineWidth: 1,
          },
        },
        interaction: { mode: "index", intersect: false },
        scales: { y: { title: { display: true, text: "Base 100" } } },
      },
    });
  } else {
    const chart = careerState.charts.equity;
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    if (!chart.options.plugins) {
      chart.options.plugins = {};
    }
    chart.options.plugins.careerTurnBoundaries = {
      boundaries: turnBoundaries,
      color: "#000000",
      lineWidth: 1,
    };
    chart.update();
  }
}

function exportCareerCsv(type) {
  if (!careerState.sessionId) {
    mostrarToastError("Selecciona una sesión.");
    return;
  }
  const bench = careerState.bench || "^GSPC";
  const url = `/api/career/export/${encodeURIComponent(
    careerState.sessionId
  )}?${qs({ type, bench })}`;
  window.open(url, "_blank", "noopener");
}

function exportCareerPng() {
  if (!careerState.charts.equity) {
    mostrarToastError("Genera el informe para exportar el gráfico.");
    return;
  }
  const link = document.createElement("a");
  link.href = careerState.charts.equity.toBase64Image("image/png", 1);
  link.download = `career_equity_${careerState.sessionId || "report"}.png`;
  link.click();
}

function submitCareerRanking() {
  if (!careerState.sessionId || !careerState.report) {
    mostrarToastError("Genera un informe antes de publicar.");
    return;
  }
  const consent = document.getElementById("career-ranking-consent")?.checked;
  if (!consent) {
    mostrarToastError("Activa el consentimiento antes de publicar en el ranking.");
    return;
  }
  const payload = {
    session_id: careerState.sessionId,
    consent: true,
    player: document.getElementById("career-player")?.value || "",
    score: careerState.report.score?.value,
    stars: careerState.report.score?.stars,
    bench: careerState.bench || "^GSPC",
  };
  const btn = document.getElementById("career-ranking-submit");
  careerSetLoading(btn, true);
  jsonPost("/api/career/ranking", payload)
    .then(() => {
      mostrarToastOk("Score enviado al ranking local.");
      refreshCareerRanking();
    })
    .catch((err) => {
      mostrarToastError(err?.message || "No se pudo enviar el ranking.");
    })
    .finally(() => careerSetLoading(btn, false));
}

function refreshCareerRanking() {
  const body = document.getElementById("career-ranking-body");
  if (!body) return;
  jsonGet("/api/career/ranking?limit=20")
    .then((data) => {
      const entries = data.entries || [];
      body.innerHTML = entries.length
        ? entries
            .map((entry, index) => {
              const period = entry.period || {};
              const score = entry.score?.toFixed?.(2) ?? entry.score ?? "—";
              const stars = entry.stars ?? "—";
              return `
                <tr>
                  <td class="col-rank">${index + 1}</td>
                  <td>${entry.player || "—"}</td>
                  <td><span class="badge badge-soft">${entry.difficulty || "—"}</span></td>
                  <td class="col-score">
                    <span class="score-main">${score}</span>
                    <span class="score-stars">(${stars}★)</span>
                  </td>
                  <td class="col-bench">${entry.bench || "—"}</td>
                  <td>${period.start || "—"} → ${period.end || "—"}</td>
                </tr>`;
            })
            .join("")
        : `<tr><td colspan="6" class="empty">Sin envíos todavía.</td></tr>`;
    })
    .catch((err) => {
      console.warn("No se pudo cargar el ranking:", err);
    });
}

function fetchCareerShare() {
  if (!careerState.sessionId) {
    mostrarToastError("Selecciona una sesión.");
    return;
  }
  const output = document.getElementById("career-share-output");
  jsonGet(`/api/career/share/${encodeURIComponent(careerState.sessionId)}`)
    .then((data) => {
      const text = JSON.stringify(data, null, 2);
      output.textContent = text;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      mostrarToastOk("Payload share generado (copiado si es posible).");
    })
    .catch((err) => {
      mostrarToastError(err?.message || "No se pudo obtener el share.");
    });
}

function careerSetLoading(button, stateFlag) {
  if (!button) return;
  if (stateFlag) {
    button.disabled = true;
    button.dataset.loading = "true";
  } else {
    button.disabled = false;
    delete button.dataset.loading;
  }
}

/* ============================================================================
 * Auxiliares de datos (sectores)
 * ==========================================================================*/

/**
 * Carga sectores en el <select id="emp-sector"> manteniendo la opciÃ³n "Todos".
 */
async function loadSectores() {
  const sectores = await jsonGet("/empresas/sectores");
  const sel = $("#emp-sector");
  sel.innerHTML =
    `<option value="">Todos los sectores</option>` +
    sectores.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function showCareerEventsModal(snapshot) {
  const applied = Array.isArray(snapshot?.events_applied)
    ? snapshot.events_applied
    : Array.isArray(snapshot?.events)
    ? snapshot.events
    : [];
  const upcoming = Array.isArray(snapshot?.events_new) ? snapshot.events_new : [];

  if (!applied.length && !upcoming.length) {
    return;
  }

  const existing = document.getElementById("career-events-modal");
  if (existing) existing.remove();

  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const overlay = document.createElement("div");
  overlay.id = "career-events-modal";
  overlay.className = "modal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "cem-title");

  const content = document.createElement("div");
  content.className = "modal__content";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal__close";
  closeBtn.setAttribute("aria-label", "Cerrar");
  closeBtn.textContent = "\u00D7";

  const header = document.createElement("div");
  header.className = "modal__header";
  const title = document.createElement("h3");
  title.id = "cem-title";
  title.textContent = "Eventos del turno";
  header.appendChild(title);

  const body = document.createElement("div");
  body.className = "modal__body";
  body.id = "cem-body";

  if (applied.length) {
    body.appendChild(buildEventsSection("Aplicados este turno", applied));
  }
  if (upcoming.length) {
    body.appendChild(buildEventsSection("Nuevos para proximos turnos", upcoming));
  }

  const footer = document.createElement("div");
  footer.className = "modal__actions";
  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "btn btn-primary";
  acceptBtn.textContent = "Entendido";
  footer.appendChild(acceptBtn);

  content.appendChild(closeBtn);
  content.appendChild(header);
  content.appendChild(body);
  content.appendChild(footer);
  overlay.appendChild(content);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => closeBtn.focus({ preventScroll: true }));

  function closeModal() {
    document.removeEventListener("keydown", onKeyDown, true);
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    if (previouslyFocused && previouslyFocused.focus) {
      previouslyFocused.focus();
    }
  }

  function onKeyDown(ev) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeModal();
    }
  }

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) closeModal();
  });
  closeBtn.addEventListener("click", closeModal);
  acceptBtn.addEventListener("click", closeModal);
  document.addEventListener("keydown", onKeyDown, true);

  function buildEventsSection(titleText, events) {
    const section = document.createElement("section");
    const heading = document.createElement("h4");
    heading.textContent = titleText;
    section.appendChild(heading);

    events.forEach((evt) => {
      const block = document.createElement("div");
      block.className = "career-events-block";

      const name = document.createElement("p");
      name.className = "career-event-name";
      name.textContent = formatEventName(evt);
      block.appendChild(name);

      const list = document.createElement("ul");
      list.className = "kv";

      [
        createKvRow("Ambito", formatScope(evt.scope)),
        createKvRow("Objetivo", formatValue(evt.target)),
        createKvRow("Impacto", formatImpact(evt.impact_pct)),
        createKvRow("Turnos restantes", formatRemaining(evt.remaining_turns)),
        createKvRow("Afectados", Array.isArray(evt.affected) && evt.affected.length ? evt.affected.join(", ") : null),
      ].forEach((row) => {
        if (row) list.appendChild(row);
      });

      block.appendChild(list);
      section.appendChild(block);
    });

    return section;
  }

  function createKvRow(labelText, valueText) {
    if (valueText === null || valueText === undefined || valueText === "") {
      return null;
    }
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${labelText}:`;
    const span = document.createElement("span");
    span.textContent = valueText;
    li.appendChild(strong);
    li.appendChild(span);
    return li;
  }

  function formatEventName(evt) {
    return evt?.name || evt?.id || "Evento";
  }

  function formatScope(scope) {
    if (!scope) return null;
    return scope.charAt(0).toUpperCase() + scope.slice(1);
  }

  function formatValue(value) {
    if (value === null || value === undefined || value === "") return null;
    return String(value);
  }

  function formatImpact(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const scaled = num * 100;
    const sign = scaled >= 0 ? "+" : "";
    return `${sign}${scaled.toFixed(2)}%`;
  }

  function formatRemaining(value) {
    if (value === null || value === undefined) return null;
    if (Number.isNaN(Number(value))) return null;
    return String(value);
  }
}
