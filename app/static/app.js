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

// --- Utilidad: resaltar coincidencias en texto (para Empresas) ---
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
};

/* ============================================================================
 * Empresas (listado + paginado + orden)
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
        : `Mostrando ${start} – ${end} de ${total} · p. ${page} · ${per_page}/pág`;
  }

  // Botones
  $("#emp-prev").disabled = state.emp.page <= 1;
  $("#emp-next").disabled = !hasNext;
}

/**
 * Enlaza eventos de bÃºsqueda, paginado y "compartir" en Empresas.
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
  readParams();

  const hasEmpresas = Boolean(document.getElementById("emp-tbody"));
  const hasAnalisis = Boolean(document.getElementById("btn-enviar-propuesta"));
  const hasHistorial = Boolean(document.getElementById("his-tbody"));

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
});

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
