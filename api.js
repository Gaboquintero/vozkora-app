// =========================================================================
// VOZKORA CONTASOFT + IA — CONECTOR SUPABASE PRODUCCIÓN (EMPRESAS/STORAGE/API)
// =========================================================================
const VOZKORA_CONFIG = {
  PUENTE_URL: 'https://vozkora-puente-contifico.onrender.com',
  EMPRESA_ID: '1b4f7aed-9583-4853-bcda-bf98c3d7f250',
  SUPABASE_BASE: 'https://dgzikmjfozhxdanhnnhx.supabase.co',
  SUPABASE_URL: 'https://dgzikmjfozhxdanhnnhx.supabase.co/rest/v1',
  SUPABASE_STORAGE_URL: 'https://dgzikmjfozhxdanhnnhx.supabase.co/storage/v1',
  STORAGE_BUCKET: 'vozkora-documentos',
  SUPABASE_KEY: 'sb_publishable_HbDtW4JNH1cTpXkqwNUhwg_UnsBP6og',
  DEFAULT_PAYMENT_URL: 'https://www.google.com/search?q=Pasarela+de+Pago+Vozkora+dLocal+Go',
  ASESOR_VIP_WHATSAPP: '593999999999',
  STORAGE_KEYS: {
    SESION: 'vozkora_sesion_activa',
    DEVICE_ID: 'vozkora_device_id_local',
    PRODUCTOS: 'vozkora_cache_productos',
    CLIENTES: 'vozkora_cache_clientes',
    COLA_OFFLINE: 'vozkora_cola_pendientes',
    PAYMENT_URL: 'vozkora_crm_payment_url'
  }
};

function supaHeaders(extra = {}) {
  return Object.assign({
    'apikey': VOZKORA_CONFIG.SUPABASE_KEY,
    'Authorization': 'Bearer ' + VOZKORA_CONFIG.SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  }, extra);
}

function obtenerUrlPasarela() {
  return localStorage.getItem(VOZKORA_CONFIG.STORAGE_KEYS.PAYMENT_URL) || VOZKORA_CONFIG.DEFAULT_PAYMENT_URL;
}

function guardarUrlPasarela(url) {
  const clean = String(url || '').trim() || VOZKORA_CONFIG.DEFAULT_PAYMENT_URL;
  localStorage.setItem(VOZKORA_CONFIG.STORAGE_KEYS.PAYMENT_URL, clean);
  return clean;
}

function obtenerDeviceIdLocal() {
  let did = localStorage.getItem(VOZKORA_CONFIG.STORAGE_KEYS.DEVICE_ID);
  if (!did) {
    did = 'DEV-' + Math.random().toString(36).slice(2, 10).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    localStorage.setItem(VOZKORA_CONFIG.STORAGE_KEYS.DEVICE_ID, did);
  }
  return did;
}

function obtenerNombreDispositivo() {
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android Móvil';
  if (/iPhone|iPad/i.test(ua)) return 'iOS Móvil';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Navegador Web';
}

// -------------------------------------------------------------------------
// CÁLCULO DE FECHAS DE CORTE (SIEMPRE DÍA 01 DEL MES)
// - MENSUAL: 01 del mes siguiente (ciclo 1 al 30/31 o 28/29 Feb)
// - ANUAL: 01 del mismo mes del año siguiente (ej. 19/11/2026 -> 01/11/2027)
// -------------------------------------------------------------------------
function calcularProximoCorte(periodicidad = 'MENSUAL', baseDate = new Date()) {
  const d = new Date(baseDate);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-11
  if (String(periodicidad).toUpperCase() === 'ANUAL') {
    const mm = String(month + 1).padStart(2, '0');
    return `${year + 1}-${mm}-01`;
  }
  const nextMonthDate = new Date(year, month + 1, 1);
  const y2 = nextMonthDate.getFullYear();
  const m2 = String(nextMonthDate.getMonth() + 1).padStart(2, '0');
  return `${y2}-${m2}-01`;
}

// Evaluar estado de cobranza/corte de una empresa en tiempo real:
// - Si control_corte === false -> 'EXENTO'
// - Si exento_hasta >= hoy -> 'EXENTO_HASTA'
// - Si hoy < fecha_proximo_corte -> 'AL_DIA'
// - Si hoy >= fecha_proximo_corte y diffDays <= 5 -> 'PENDIENTE_RENOVACION' (Franja roja superior)
// - Si diffDays > 5 -> 'BLOQUEADO_CORTE' (Bloqueo total de la App)
function evaluarEstadoSuscripcion(emp) {
  if (!emp) return { estado: 'AL_DIA', diasMora: 0, fechaCorte: '' };
  if (emp.rol === 'DEMO' || emp.entorno === 'DEMO') {
    return { estado: 'EXENTO', diasMora: 0, fechaCorte: emp.fecha_proximo_corte || '' };
  }
  if (emp.control_corte === false) {
    return { estado: 'EXENTO', diasMora: 0, fechaCorte: emp.fecha_proximo_corte || '' };
  }
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  if (emp.exento_hasta && emp.exento_hasta >= todayStr) {
    return { estado: 'EXENTO_HASTA', diasMora: 0, fechaCorte: emp.fecha_proximo_corte || '', exentoHasta: emp.exento_hasta };
  }

  const corteStr = emp.fecha_proximo_corte || calcularProximoCorte(emp.periodicidad || 'MENSUAL');
  const corteDate = new Date(corteStr + 'T00:00:00');
  const todayMidnight = new Date(todayStr + 'T00:00:00');
  const diffDays = Math.floor((todayMidnight - corteDate) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { estado: 'AL_DIA', diasMora: 0, fechaCorte: corteStr };
  }
  if (diffDays <= 5) {
    return { estado: 'PENDIENTE_RENOVACION', diasMora: diffDays, fechaCorte: corteStr };
  }
  return { estado: 'BLOQUEADO_CORTE', diasMora: diffDays, fechaCorte: corteStr };
}

// -------------------------------------------------------------------------
// A. AUTENTICACIÓN Y SINCRONIZACIÓN DE SESIÓN DESDE SUPABASE
// -------------------------------------------------------------------------
async function refrescarSesionDesdeSupabase(sesionActual) {
  if (!sesionActual || !sesionActual.email) return sesionActual;
  try {
    const uResp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_usuarios?email=eq.${encodeURIComponent(sesionActual.email)}&select=*`, { headers: supaHeaders() });
    if (!uResp.ok) return sesionActual;
    const uRows = await uResp.json();
    if (!uRows || uRows.length === 0) return sesionActual;
    const user = uRows[0];

    let empresa = null;
    if (user.empresa_id) {
      const eResp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?id=eq.${encodeURIComponent(user.empresa_id)}&select=*`, { headers: supaHeaders() });
      if (eResp.ok) {
        const eRows = await eResp.json();
        if (eRows && eRows.length > 0) empresa = eRows[0];
      }
    } else if (user.empresa_ruc) {
      const eResp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?ruc=eq.${encodeURIComponent(user.empresa_ruc)}&select=*`, { headers: supaHeaders() });
      if (eResp.ok) {
        const eRows = await eResp.json();
        if (eRows && eRows.length > 0) empresa = eRows[0];
      }
    }

    const sesionFresca = Object.assign({}, sesionActual, user, {
      empresa_id: empresa ? empresa.id : user.empresa_id,
      empresa_nombre: empresa ? empresa.nombre : user.empresa_nombre,
      empresa_ruc: empresa ? empresa.ruc : user.empresa_ruc,
      empresa_telefono: empresa ? empresa.telefono : user.empresa_telefono,
      plan_activo: empresa ? empresa.plan_activo : user.plan_activo,
      periodicidad: empresa ? (empresa.periodicidad || 'MENSUAL') : 'MENSUAL',
      fecha_proximo_corte: empresa ? (empresa.fecha_proximo_corte || calcularProximoCorte('MENSUAL')) : calcularProximoCorte('MENSUAL'),
      control_corte: empresa ? (empresa.control_corte !== false) : true,
      exento_hasta: empresa ? (empresa.exento_hasta || null) : null,
      max_usuarios: empresa ? empresa.max_usuarios : 5,
      sva_elegidos_fijos: empresa ? !!empresa.sva_elegidos_fijos : false,
      packs_ia: empresa ? empresa.packs_ia : user.packs_ia,
      entorno: empresa ? empresa.entorno : user.entorno,
      contifico_api_key: empresa ? empresa.contifico_api_key : user.contifico_api_key,
      contifico_pos_token: empresa ? empresa.contifico_pos_token : user.contifico_pos_token
    });
    localStorage.setItem(VOZKORA_CONFIG.STORAGE_KEYS.SESION, JSON.stringify(sesionFresca));
    return sesionFresca;
  } catch (e) {
    return sesionActual;
  }
}

async function loginVozkora(email, clave) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanPass = String(clave || '').trim();
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_usuarios?email=eq.${encodeURIComponent(cleanEmail)}&select=*`;
  const resp = await fetch(url, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('No se pudo conectar con Supabase');
  const rows = await resp.json();
  if (!rows || rows.length === 0) {
    return { ok: false, error: 'Usuario no encontrado en Vozkora.' };
  }
  const user = rows[0];
  if (user.clave !== cleanPass) {
    return { ok: false, error: 'Contraseña incorrecta.' };
  }
  if (!user.activo) {
    return { ok: false, error: 'Este usuario está suspendido. Contacta al administrador.' };
  }

  let empresa = null;
  if (user.empresa_id) {
    const empResp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?id=eq.${encodeURIComponent(user.empresa_id)}&select=*`, { headers: supaHeaders() });
    if (empResp.ok) {
      const empRows = await empResp.json();
      if (empRows && empRows.length > 0) empresa = empRows[0];
    }
  } else if (user.empresa_ruc) {
    const empResp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?ruc=eq.${encodeURIComponent(user.empresa_ruc)}&select=*`, { headers: supaHeaders() });
    if (empResp.ok) {
      const empRows = await empResp.json();
      if (empRows && empRows.length > 0) empresa = empRows[0];
    }
  }

  if (empresa && !empresa.activa) {
    return { ok: false, error: `La empresa ${empresa.nombre} se encuentra suspendida en Vozkora.` };
  }

  const localDevId = obtenerDeviceIdLocal();
  if (user.rol !== 'DEMO' && user.rol !== 'SUPERADMIN') {
    if (user.session_token && user.session_token !== localDevId) {
      return {
        ok: false,
        error: `⛔ Acceso bloqueado: El usuario ${user.email} ya tiene sesión activa en otro dispositivo (${user.dispositivo_info || 'Otro equipo'}). Solicita liberar dispositivo en Soporte / CRM.`
      };
    }
    await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_usuarios?id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify({
        session_token: localDevId,
        dispositivo_info: obtenerNombreDispositivo(),
        ultimo_acceso: new Date().toISOString()
      })
    });
    user.session_token = localDevId;
  }

  const sesionCompleta = Object.assign({}, user, {
    empresa_id: empresa ? empresa.id : user.empresa_id,
    empresa_nombre: empresa ? empresa.nombre : user.empresa_nombre,
    empresa_ruc: empresa ? empresa.ruc : user.empresa_ruc,
    empresa_telefono: empresa ? empresa.telefono : user.empresa_telefono,
    plan_activo: empresa ? empresa.plan_activo : user.plan_activo,
    periodicidad: empresa ? (empresa.periodicidad || 'MENSUAL') : 'MENSUAL',
    fecha_proximo_corte: empresa ? (empresa.fecha_proximo_corte || calcularProximoCorte('MENSUAL')) : calcularProximoCorte('MENSUAL'),
    control_corte: empresa ? (empresa.control_corte !== false) : true,
    exento_hasta: empresa ? (empresa.exento_hasta || null) : null,
    max_usuarios: empresa ? empresa.max_usuarios : 5,
      sva_elegidos_fijos: empresa ? !!empresa.sva_elegidos_fijos : false,
    packs_ia: empresa ? empresa.packs_ia : user.packs_ia,
    entorno: empresa ? empresa.entorno : user.entorno,
    contifico_api_key: empresa ? empresa.contifico_api_key : user.contifico_api_key,
    contifico_pos_token: empresa ? empresa.contifico_pos_token : user.contifico_pos_token,
    sva_elegidos_fijos: empresa ? !!empresa.sva_elegidos_fijos : false
  });

  localStorage.setItem(VOZKORA_CONFIG.STORAGE_KEYS.SESION, JSON.stringify(sesionCompleta));
  return { ok: true, user: sesionCompleta };
}

function obtenerSesionVozkora() {
  try {
    return JSON.parse(localStorage.getItem(VOZKORA_CONFIG.STORAGE_KEYS.SESION) || 'null');
  } catch (e) {
    return null;
  }
}

async function cerrarSesionVozkora() {
  const ses = obtenerSesionVozkora();
  if (ses && ses.id && ses.rol !== 'DEMO' && ses.rol !== 'SUPERADMIN') {
    try {
      await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_usuarios?id=eq.${encodeURIComponent(ses.id)}`, {
        method: 'PATCH',
        headers: supaHeaders(),
        body: JSON.stringify({ session_token: null, dispositivo_info: null })
      });
    } catch (e) {}
  }
  localStorage.removeItem(VOZKORA_CONFIG.STORAGE_KEYS.SESION);
}

// -------------------------------------------------------------------------
// B. VOZKORA CONTROL CRM — GESTIÓN DE EMPRESAS (PERIODICIDAD, CORTE Y API)
// -------------------------------------------------------------------------
async function crmListarEmpresas() {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?select=*&order=creado_en.desc`;
  const resp = await fetch(url, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('Error listando empresas');
  return await resp.json();
}

async function crmCrearEmpresa(payload) {
  const per = payload.periodicidad || 'MENSUAL';
  const body = Object.assign({
    periodicidad: per,
    fecha_proximo_corte: payload.fecha_proximo_corte || calcularProximoCorte(per),
    control_corte: payload.control_corte !== undefined ? payload.control_corte : true,
    exento_hasta: payload.exento_hasta || null
  }, payload);
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Error creando empresa');
  return Array.isArray(data) ? data[0] : data;
}

async function crmActualizarEmpresa(id, campos) {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?id=eq.${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: supaHeaders(),
    body: JSON.stringify(campos)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Error actualizando empresa');
  return Array.isArray(data) ? data[0] : data;
}

// -------------------------------------------------------------------------
// C. VOZKORA CONTROL CRM — GESTIÓN DE USUARIOS POR EMPRESA Y CUPO DE PLAN
// -------------------------------------------------------------------------
async function crmListarUsuarios() {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_usuarios?select=*&order=creado_en.desc`;
  const resp = await fetch(url, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('Error listando usuarios');
  return await resp.json();
}

async function crmCrearUsuario(payload) {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_usuarios`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Error creando usuario');
  return Array.isArray(data) ? data[0] : data;
}

async function crmActualizarUsuario(id, campos) {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_usuarios?id=eq.${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: supaHeaders(),
    body: JSON.stringify(campos)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Error actualizando usuario');
  return Array.isArray(data) ? data[0] : data;
}


async function crmEliminarUsuario(id) {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_usuarios?id=eq.${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: supaHeaders()
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.message || 'Error eliminando usuario');
  }
  return true;
}

// -------------------------------------------------------------------------
// D. SISTEMA DE TICKETS DE SOPORTE / ALTA DE USUARIOS
// -------------------------------------------------------------------------
async function crearTicketVozkora(ticketPayload) {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_tickets`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(ticketPayload)
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Error enviando ticket');
  return Array.isArray(data) ? data[0] : data;
}

async function crmListarTickets() {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_tickets?select=*&order=creado_en.desc`;
  const resp = await fetch(url, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('Error listando tickets');
  return await resp.json();
}

async function crmActualizarTicket(id, estado, detalleObj = null) {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_tickets?id=eq.${encodeURIComponent(id)}`;
  const bodyPayload = { estado };
  if (detalleObj) bodyPayload.detalle = detalleObj;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: supaHeaders(),
    body: JSON.stringify(bodyPayload)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.message || data.hint || ('HTTP ' + resp.status + ' al actualizar ticket'));
  }
  return Array.isArray(data) ? data[0] : data;
}

// -------------------------------------------------------------------------
// E. SUBIDA REAL DE PDF DE RUC A SUPABASE STORAGE (vozkora-documentos)
// -------------------------------------------------------------------------
async function subirPdfRucSupabase(file, clienteRuc) {
  const ses = obtenerSesionVozkora();
  const empRuc = ses ? ses.empresa_ruc : '123456789001';
  const safeName = (file.name || 'ruc.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `${empRuc}/${clienteRuc || 'SIN_RUC'}_${Date.now()}_${safeName}`;
  const uploadUrl = `${VOZKORA_CONFIG.SUPABASE_STORAGE_URL}/object/${VOZKORA_CONFIG.STORAGE_BUCKET}/${objectPath}`;

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': VOZKORA_CONFIG.SUPABASE_KEY,
      'Authorization': 'Bearer ' + VOZKORA_CONFIG.SUPABASE_KEY,
      'Content-Type': file.type || 'application/pdf',
      'x-upsert': 'true'
    },
    body: file
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || err.error || ('Error Storage HTTP ' + resp.status));
  }

  const publicUrl = `${VOZKORA_CONFIG.SUPABASE_STORAGE_URL}/object/public/${VOZKORA_CONFIG.STORAGE_BUCKET}/${objectPath}`;
  return { ok: true, url: publicUrl, path: objectPath, fileName: file.name };
}

// -------------------------------------------------------------------------
// F. REPOSITORIO MAESTRO DE AUDITORÍA ("HOJAS TIPO EXCEL" EN SUPABASE)
//    + ACTUALIZACIÓN REAL DE REGISTROS OFFLINE (PENDIENTE_OFFLINE -> AUTORIZADA)
// -------------------------------------------------------------------------
async function registrarEnRepositorio(tabla, fila) {
  try {
    const ses = obtenerSesionVozkora();
    const registro = Object.assign({
      empresa_ruc: ses ? ses.empresa_ruc : '123456789001',
      empresa_nombre: ses ? ses.empresa_nombre : 'ACME',
      creado_por_email: ses ? ses.email : 'demo@vozkora.com',
      entorno: ses ? ses.entorno : 'DEMO'
    }, fila);
    const url = `${VOZKORA_CONFIG.SUPABASE_URL}/${tabla}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: supaHeaders(),
      body: JSON.stringify(registro)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) ? data[0] : data;
  } catch (e) {
    return null;
  }
}

async function actualizarRegistroRepositorio(tabla, idFila, campos) {
  if (!idFila) return false;
  try {
    const url = `${VOZKORA_CONFIG.SUPABASE_URL}/${tabla}?id=eq.${encodeURIComponent(idFila)}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify(campos)
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

async function consultarRepositorio(tabla, empresaRucFiltro = '') {
  let url = `${VOZKORA_CONFIG.SUPABASE_URL}/${tabla}?select=*&order=creado_en.desc&limit=200`;
  if (empresaRucFiltro) {
    url += `&empresa_ruc=eq.${encodeURIComponent(empresaRucFiltro)}`;
  }
  const resp = await fetch(url, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('Error consultando hoja ' + tabla);
  return await resp.json();
}

// -------------------------------------------------------------------------
// G. PUENTE RENDER + SIIGO CONTÍFICO + MODO OFFLINE
// -------------------------------------------------------------------------
async function verificarConexionPuente() {
  try {
    const resp = await fetch(`${VOZKORA_CONFIG.PUENTE_URL}/`, { method: 'GET' });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

async function obtenerProductosVozkora() {
  const cacheKey = VOZKORA_CONFIG.STORAGE_KEYS.PRODUCTOS;
  try {
    const resp = await fetch(
      `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${VOZKORA_CONFIG.EMPRESA_ID}/productos`
    );
    const data = await resp.json();

    if (data.ok && Array.isArray(data.productos)) {
      localStorage.setItem(cacheKey, JSON.stringify(data.productos));
      return { origen: 'ONLINE', productos: data.productos };
    }
    throw new Error(data.error || 'Error leyendo productos');
  } catch (err) {
    const locales = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    return { origen: 'OFFLINE', productos: locales };
  }
}


async function actualizarClienteEnRepositorio(empresaRuc, clienteRucCi, campos) {
  if (!empresaRuc || !clienteRucCi) return false;
  try {
    const url = `${VOZKORA_CONFIG.SUPABASE_URL}/repo_clientes?empresa_ruc=eq.${encodeURIComponent(empresaRuc)}&cliente_ruc_ci=eq.${encodeURIComponent(clienteRucCi)}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify(campos)
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

async function guardarSeleccionSvaGratisEmpresa(empresaId, packsIa, fijarSeleccion = true) {
  if (!empresaId) return null;
  return await crmActualizarEmpresa(empresaId, {
    packs_ia: packsIa,
    sva_elegidos_fijos: fijarSeleccion
  });
}


async function sincronizarClientePuenteContifico(clientePayload, esEdicion = false) {
  const ses = obtenerSesionVozkora();
  const empId = (ses && ses.empresa_id) ? ses.empresa_id : VOZKORA_CONFIG.EMPRESA_ID;
  const endpoint = `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${encodeURIComponent(empId)}/cliente`;
  try {
    const resp = await fetch(endpoint, {
      method: esEdicion ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clientePayload)
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


// -------------------------------------------------------------------------
// H. SUBIDA DE FOTOS DE VISITA RUTA GPS / COMPROBANTES DEUNA A STORAGE
// -------------------------------------------------------------------------
async function subirEvidenciaFotoSupabase(fileOrBlob, carpeta = 'rutas', prefijo = 'EVID') {
  const ses = obtenerSesionVozkora();
  const empRuc = ses ? ses.empresa_ruc : '123456789001';
  const rawName = (fileOrBlob && fileOrBlob.name) ? fileOrBlob.name : `${prefijo}.jpg`;
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `${empRuc}/${carpeta}/${prefijo}_${Date.now()}_${safeName}`;
  const uploadUrl = `${VOZKORA_CONFIG.SUPABASE_STORAGE_URL}/object/${VOZKORA_CONFIG.STORAGE_BUCKET}/${objectPath}`;

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': VOZKORA_CONFIG.SUPABASE_KEY,
      'Authorization': 'Bearer ' + VOZKORA_CONFIG.SUPABASE_KEY,
      'Content-Type': (fileOrBlob && fileOrBlob.type) || 'image/jpeg',
      'x-upsert': 'true'
    },
    body: fileOrBlob
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || err.error || ('Error Storage HTTP ' + resp.status));
  }

  const publicUrl = `${VOZKORA_CONFIG.SUPABASE_STORAGE_URL}/object/public/${VOZKORA_CONFIG.STORAGE_BUCKET}/${objectPath}`;
  return { ok: true, url: publicUrl, path: objectPath, fileName: rawName };
}

async function listarVisitasRutaSupabase(empresaRuc) {
  if (!empresaRuc) return [];
  try {
    const url = `${VOZKORA_CONFIG.SUPABASE_URL}/repo_rutas_visitas?empresa_ruc=eq.${encodeURIComponent(empresaRuc)}&select=*&order=fecha_visita.asc,hora_programada.asc`;
    const resp = await fetch(url, { headers: supaHeaders() });
    if (!resp.ok) return [];
    return await resp.json();
  } catch (e) {
    return [];
  }
}

function obtenerFechaLocalISO(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function guardarRutasLocalStorage(empresaRuc, visitas) {
  const key = 'vozkora_rutas_' + (empresaRuc || '123456789001');
  try {
    localStorage.setItem(key, JSON.stringify(visitas || []));
    return true;
  } catch (e) {
    return false;
  }
}

function leerRutasLocalStorage(empresaRuc) {
  const key = 'vozkora_rutas_' + (empresaRuc || '123456789001');
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

async function crearVisitaRutaSupabase(payload) {
  const ses = obtenerSesionVozkora();
  const body = Object.assign({
    empresa_ruc: (ses && ses.empresa_ruc) ? ses.empresa_ruc : '123456789001',
    empresa_nombre: (ses && ses.empresa_nombre) ? ses.empresa_nombre : 'ACME',
    creado_por_email: (ses && ses.email) ? ses.email : 'demo@vozkora.com'
  }, payload);
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/repo_rutas_visitas`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(body)
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return Array.isArray(data) ? data[0] : data;
}

async function actualizarVisitaRutaSupabase(id, campos) {
  if (!id) return false;
  try {
    const url = `${VOZKORA_CONFIG.SUPABASE_URL}/repo_rutas_visitas?id=eq.${encodeURIComponent(id)}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: supaHeaders(),
      body: JSON.stringify(campos)
    });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// -------------------------------------------------------------------------
// I. PERSISTENCIA REAL DE COLA OFFLINE (SQLITE LOCAL / LOCALSTORAGE)
// -------------------------------------------------------------------------
function obtenerClaveColaOffline(empresaRuc) {
  const ses = obtenerSesionVozkora();
  const ruc = empresaRuc || (ses && ses.empresa_ruc) || '123456789001';
  return `${VOZKORA_CONFIG.STORAGE_KEYS.COLA_OFFLINE}_${ruc}`;
}

function guardarColaOfflineLocal(items, empresaRuc = '') {
  try {
    const key = obtenerClaveColaOffline(empresaRuc);
    const globalKey = `${VOZKORA_CONFIG.STORAGE_KEYS.COLA_OFFLINE}_GLOBAL`;
    const serializable = (items || []).map(it => ({
      id: it.id,
      module: it.module,
      ref: it.ref,
      detail: it.detail,
      time: it.time,
      empresaRuc: it.empresaRuc || empresaRuc || ((obtenerSesionVozkora() || {}).empresa_ruc) || '123456789001',
      repoTable: it.repoTable || null,
      repoRowId: it.repoRowId || null,
      payload: it.payload || null
    }));
    const jsonStr = JSON.stringify(serializable);
    localStorage.setItem(key, jsonStr);
    localStorage.setItem(globalKey, jsonStr);
    return true;
  } catch (e) {
    return false;
  }
}

function leerColaOfflineLocal(empresaRuc = '') {
  try {
    const key = obtenerClaveColaOffline(empresaRuc);
    const globalKey = `${VOZKORA_CONFIG.STORAGE_KEYS.COLA_OFFLINE}_GLOBAL`;
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    const rawGlobal = localStorage.getItem(globalKey);
    const parsedGlobal = rawGlobal ? JSON.parse(rawGlobal) : [];
    if (!Array.isArray(parsedGlobal)) return [];
    if (!empresaRuc) return parsedGlobal;
    return parsedGlobal.filter(x => !x.empresaRuc || x.empresaRuc === empresaRuc);
  } catch (e) {
    return [];
  }
}

async function verificarConectividadRealVozkora() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  const nonce = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(
      `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?select=id&limit=1&_nocache=${nonce}`,
      {
        method: 'GET',
        headers: supaHeaders(),
        cache: 'no-store',
        signal: ctrl.signal
      }
    );
    clearTimeout(timer);
    if (resp && (resp.ok || resp.status < 500)) return true;
  } catch (e) {}

  try {
    const ctrl2 = new AbortController();
    const timer2 = setTimeout(() => ctrl2.abort(), 2200);
    await fetch(`https://connectivitycheck.gstatic.com/generate_204?_nocache=${nonce}`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl2.signal
    });
    clearTimeout(timer2);
    return true;
  } catch (e2) {
    return false;
  }
}
