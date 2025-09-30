// --- Utilidades ---
const $ = (sel) => document.querySelector(sel);
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : "");
const qs = (obj) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

async function jsonGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

async function jsonPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

// --- Estado simple ---
const state = {
  emp: { page: 1, per_page: 10, q: "", sector: "" },
  his: { page: 1, per_page: 10, ticker: "", desde: "", hasta: "" },
};

// --- Empresas (lista + paginado) ---
async function loadEmpresas() {
  const { page, per_page, q, sector } = state.emp;
  const query = qs({ page, per_page, q, sector });
  const data = await jsonGet(`/empresas?${query}`);
  // Respuesta paginada (cuando page/per_page presentes)
  const items = Array.isArray(data) ? data : data.items;
  const total = Array.isArray(data) ? items.length : data.total;
  const hasNext = Array.isArray(data) ? false : data.has_next;

  // Render
  $("#emp-list").innerHTML = items
    .map(
      (e) =>
        `<div class="row" style="justify-content:space-between;border-bottom:1px solid #e2e8f0;padding:6px 0;">
          <div><strong>${e.ticker}</strong> — ${e.nombre}</div>
          <span class="muted">${e.sector}</span>
        </div>`
    )
    .join("");
  $("#emp-total").textContent = `${total} resultados`;
  $("#emp-page").textContent = `p. ${state.emp.page}`;
  $("#emp-prev").disabled = state.emp.page <= 1;
  $("#emp-next").disabled = !hasNext;
}

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

// --- Enviar análisis ---
function payloadAnalisis() {
  return {
    ticker: $("#anl-ticker").value.trim(),
    importe_inicial: Number($("#anl-importe").value),
    horizonte_anios: Number($("#anl-horizonte").value),
    supuestos: {
      crecimiento_anual_pct: Number($("#anl-crec").value),
      margen_seguridad_pct: Number($("#anl-margen").value),
      roe_pct: Number($("#anl-roe").value),
      deuda_sobre_activos_pct: Number($("#anl-deuda").value),
    },
    justificacion: $("#anl-just").value.trim(),
  };
}

function renderObservaciones(list) {
  $("#anl-observaciones").innerHTML = (list || [])
    .map((o) => {
      const cls =
        o.tipo === "ok"
          ? "ok"
          : o.tipo === "alerta"
          ? "alerta"
          : "mejora";
      return `<span class="pill ${cls}">${o.msg}</span>`;
    })
    .join("");
}

function bindAnalisisForm() {
  $("#anl-enviar").addEventListener("click", async () => {
    try {
      const p = payloadAnalisis();
      const r = await jsonPost("/analisis", p);
      $("#anl-resultado").textContent = `Puntuación: ${r.puntuacion} — ${r.resumen}`;
      renderObservaciones(r.observaciones);
      // refresca historial tras crear
      state.his.page = 1;
      await loadHistorial();
    } catch (e) {
      $("#anl-resultado").textContent = "";
      $("#anl-observaciones").innerHTML = "";
      alert(`No se pudo analizar:\n${e.message}`);
    }
  });
}

// --- Historial (lista + filtros + paginado + CSV) ---
async function loadHistorial() {
  const { page, per_page, ticker, desde, hasta } = state.his;
  const query = qs({ page, per_page, ticker, desde, hasta });
  const data = await jsonGet(`/analisis?${query}`);
  const items = Array.isArray(data) ? data : data.items;
  const total = Array.isArray(data) ? items.length : data.total;
  const hasNext = Array.isArray(data) ? false : data.has_next;

  $("#his-tbody").innerHTML = (items || [])
    .map(
      (h) => `<tr>
        <td class="muted">${fmtDate(h.timestamp)}</td>
        <td><strong>${h.ticker || ""}</strong></td>
        <td>${h.importe_inicial ?? ""}</td>
        <td>${h.horizonte_anios ?? ""} años</td>
        <td><strong>${h.puntuacion ?? ""}</strong></td>
        <td>${(h.resumen || "").replace(/\n/g, " ")}</td>
      </tr>`
    )
    .join("");

  $("#his-total").textContent = `${total} análisis`;
  $("#his-page").textContent = `p. ${state.his.page}`;
  $("#his-prev").disabled = state.his.page <= 1;
  $("#his-next").disabled = !hasNext;
}

function exportCSV() {
  const { ticker, desde, hasta } = state.his;
  const query = qs({ ticker, desde, hasta });
  const url = `/analisis.csv${query ? "?" + query : ""}`;
  // descarga
  window.location.href = url;
}

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

// --- Boot ---
document.addEventListener("DOMContentLoaded", () => {
  bindEmpresas();
  bindAnalisisForm();
  bindHistorial();
  loadEmpresas().catch((e) => alert(e.message));
  loadHistorial().catch((e) => alert(e.message));
});
