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
  const btn = document.getElementById("anl-enviar");
  ["anl-ticker","anl-importe","anl-horizonte","anl-crec","anl-margen","anl-roe","anl-deuda","anl-just"].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => {
      // al modificar, limpia error de ese campo
      const map = {
        "anl-ticker":"ticker","anl-importe":"importe","anl-horizonte":"horizonte",
        "anl-crec":"crec","anl-margen":"margen","anl-roe":"roe","anl-deuda":"deuda","anl-just":"just"
      };
      const k = map[id];
      const err = document.getElementById(`err-${k}`);
      if (err) err.textContent = "";
      el.classList.remove("invalid");
    });
  });

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
      renderObservaciones(r.observaciones);     // ya lo tienes
      // refresca historial
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



// --- Historial (lista + filtros + paginado + CSV) ---
async function loadHistorial() {
  const { page, per_page, ticker, desde, hasta } = state.his;
  const query = qs({ page, per_page, ticker, desde, hasta });
  const data = await jsonGet(`/analisis?${query}`);
  const items = Array.isArray(data) ? data : data.items;
  const total = Array.isArray(data) ? items.length : data.total;
  const hasNext = Array.isArray(data) ? false : data.has_next;

  $("#his-tbody").innerHTML = (items || [])
  .map((h, idx) => {
    const obs = JSON.stringify(h.observaciones || []);
    return `<tr>
      <td class="muted">${fmtDate(h.timestamp)}</td>
      <td><strong>${h.ticker || ""}</strong></td>
      <td>${h.importe_inicial ?? ""}</td>
      <td>${h.horizonte_anios ?? ""} años</td>
      <td><strong>${h.puntuacion ?? ""}</strong></td>
      <td>
        ${(h.resumen || "").replace(/\n/g, " ")}
        <button class="secondary" data-obs='${obs.replaceAll("'", "&apos;")}' style="margin-left:6px;">Ver</button>
      </td>
    </tr>`;
  })
  .join("");
// Enlaza botones "Ver"
document.querySelectorAll('#his-tbody button[data-obs]').forEach(btn => {
  btn.addEventListener('click', () => {
    const list = JSON.parse(btn.getAttribute('data-obs') || "[]");
    const html = (list || []).map(o => {
      const cls = o.tipo === "ok" ? "ok" : o.tipo === "alerta" ? "alerta" : "mejora";
      return `<div class="pill ${cls}" style="display:inline-block;margin:4px 6px 0 0;">${o.msg}</div>`;
    }).join("") || "<span class='muted'>Sin observaciones</span>";
    $("#modal-body").innerHTML = html;
    $("#modal").style.display = "flex";
  });
});

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

function clearErrors() {
  ["ticker","importe","horizonte","crec","margen","roe","deuda","just"].forEach((k) => {
    const el = document.getElementById(`err-${k}`);
    if (el) el.textContent = "";
  });
  ["anl-ticker","anl-importe","anl-horizonte","anl-crec","anl-margen","anl-roe","anl-deuda","anl-just"]
    .forEach(id => document.getElementById(id)?.classList.remove("invalid"));
}

function validateForm(p) {
  const errs = {};
  if (!p.ticker) errs.ticker = "Obligatorio.";
  if (!(p.importe_inicial > 0)) errs.importe = "Debe ser > 0.";
  if (!(Number.isInteger(p.horizonte_anios) && p.horizonte_anios >= 5)) errs.horizonte = "Debe ser entero ≥ 5.";

  const sup = p.supuestos || {};
  const within = (v) => Number.isFinite(v) && v >= 0 && v <= 100;
  if (!within(sup.crecimiento_anual_pct)) errs.crec = "Debe estar entre 0 y 100.";
  if (!within(sup.margen_seguridad_pct)) errs.margen = "Debe estar entre 0 y 100.";
  if (!within(sup.roe_pct)) errs.roe = "Debe estar entre 0 y 100.";
  if (!within(sup.deuda_sobre_activos_pct)) errs.deuda = "Debe estar entre 0 y 100.";

  if (!p.justificacion || p.justificacion.trim().length < 20) errs.just = "Mínimo 20 caracteres.";
  return errs;
}

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
  if (firstInvalid) firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadSectores() {
  const sectores = await jsonGet("/empresas/sectores");
  const sel = $("#emp-sector");
  // Mantén la opción "Todos los sectores"
  sel.innerHTML = `<option value="">Todos los sectores</option>` +
    sectores.map(s => `<option value="${s}">${s}</option>`).join("");
}



// --- Boot ---
document.addEventListener("DOMContentLoaded", async () => {
  bindEmpresas();
  bindAnalisisForm();
  bindHistorial();
 try {
    await loadSectores();
  } catch (e) {
    console.warn("No se pudieron cargar sectores:", e);
  }
  loadEmpresas().catch((e) => alert(e.message));
  loadHistorial().catch((e) => alert(e.message));

    $("#modal-close").addEventListener("click", () => { $("#modal").style.display = "none"; });
$("#modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") $("#modal").style.display = "none";
});


});
