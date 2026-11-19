// =========================================================================
// VOZKORA CONTASOFT + IA — CONECTOR SUPABASE (EMPRESAS / USUARIOS / API)
// =========================================================================
const VOZKORA_CONFIG = {
  PUENTE_URL: 'https://vozkora-puente-contifico.onrender.com',
  EMPRESA_ID: '1b4f7aed-9583-4853-bcda-bf98c3d7f250',
  SUPABASE_URL: 'https://dgzikmjfozhxdanhnnhx.supabase.co/rest/v1',
  SUPABASE_KEY: 'sb_publishable_HbDtW4JNH1cTpXkqwNUhwg_UnsBP6og',
  STORAGE_KEYS: {
    SESION: 'vozkora_sesion_activa',
    DEVICE_ID: 'vozkora_device_id_local',
    PRODUCTOS: 'vozkora_cache_productos',
    CLIENTES: 'vozkora_cache_clientes',
    COLA_OFFLINE: 'vozkora_cola_pendientes'
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
// A. AUTENTICACIÓN CON VALIDACIÓN DE EMPRESA + BLOQUEO 1 SOLO DISPOSITIVO
// -------------------------------------------------------------------------
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

  // Consultar la empresa vinculada para heredar plan, entorno, API Contífico y estado activo
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

  // Bloqueo de sesión única por dispositivo (excepto DEMO y SUPERADMIN)
  const localDevId = obtenerDeviceIdLocal();
  if (user.rol !== 'DEMO' && user.rol !== 'SUPERADMIN') {
    if (user.session_token && user.session_token !== localDevId) {
      return {
        ok: false,
        error: `⛔ Acceso bloqueado: El usuario ${user.email} ya tiene sesión activa en otro dispositivo (${user.dispositivo_info || 'Otro equipo'}). Solicita liberar dispositivo en Soporte / CRM.`
      };
    }
    // Registrar este dispositivo como sesión única activa
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

  // Mezclar datos vigentes de la empresa en la sesión del usuario
  const sesionCompleta = Object.assign({}, user, {
    empresa_id: empresa ? empresa.id : user.empresa_id,
    empresa_nombre: empresa ? empresa.nombre : user.empresa_nombre,
    empresa_ruc: empresa ? empresa.ruc : user.empresa_ruc,
    empresa_telefono: empresa ? empresa.telefono : user.empresa_telefono,
    plan_activo: empresa ? empresa.plan_activo : user.plan_activo,
    max_usuarios: empresa ? empresa.max_usuarios : 5,
    packs_ia: empresa ? empresa.packs_ia : user.packs_ia,
    entorno: empresa ? empresa.entorno : user.entorno,
    contifico_api_key: empresa ? empresa.contifico_api_key : user.contifico_api_key,
    contifico_pos_token: empresa ? empresa.contifico_pos_token : user.contifico_pos_token
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
// B. VOZKORA CONTROL CRM — GESTIÓN DE EMPRESAS (REGISTRO PRIVADO SAAS)
// -------------------------------------------------------------------------
async function crmListarEmpresas() {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?select=*&order=creado_en.desc`;
  const resp = await fetch(url, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('Error listando empresas');
  return await resp.json();
}

async function crmCrearEmpresa(payload) {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(payload)
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

// -------------------------------------------------------------------------
// D. SISTEMA DE TICKETS DE ALTA DE USUARIOS / SOPORTE / VENTAS
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
// E. REPOSITORIO MAESTRO DE AUDITORÍA ("HOJAS TIPO EXCEL" EN SUPABASE)
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
    return resp.ok;
  } catch (e) {
    return false;
  }
}

async function consultarRepositorio(tabla, empresaRucFiltro = '') {
  let url = `${VOZKORA_CONFIG.SUPABASE_URL}/${tabla}?select=*&order=creado_en.desc&limit=100`;
  if (empresaRucFiltro) {
    url += `&empresa_ruc=eq.${encodeURIComponent(empresaRucFiltro)}`;
  }
  const resp = await fetch(url, { headers: supaHeaders() });
  if (!resp.ok) throw new Error('Error consultando hoja ' + tabla);
  return await resp.json();
}

// -------------------------------------------------------------------------
// F. PUENTE RENDER + SIIGO CONTÍFICO + MODO OFFLINE
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

async function emitirDocumentoVozkora(payloadFactura) {
  try {
    const resp = await fetch(
      `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${VOZKORA_CONFIG.EMPRESA_ID}/documento`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFactura)
      }
    );
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'Fallo en envío');
    return { estado: 'ENVIADO_SRI', respuesta: data };
  } catch (err) {
    const cola = JSON.parse(localStorage.getItem(VOZKORA_CONFIG.STORAGE_KEYS.COLA_OFFLINE) || '[]');
    cola.push({
      id_local: 'OFF-' + Date.now(),
      fecha_registro: new Date().toISOString(),
      payload: payloadFactura
    });
    localStorage.setItem(VOZKORA_CONFIG.STORAGE_KEYS.COLA_OFFLINE, JSON.stringify(cola));
    return { estado: 'GUARDADO_OFFLINE', pendientes: cola.length };
  }
}

async function sincronizarColaOffline() {
  const colaKey = VOZKORA_CONFIG.STORAGE_KEYS.COLA_OFFLINE;
  const cola = JSON.parse(localStorage.getItem(colaKey) || '[]');
  if (cola.length === 0) return { sincronizados: 0, restantes: 0 };

  const restantes = [];
  let sincronizados = 0;

  for (const item of cola) {
    try {
      const resp = await fetch(
        `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${VOZKORA_CONFIG.EMPRESA_ID}/documento`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        }
      );
      const data = await resp.json();
      if (resp.ok && data.ok) {
        sincronizados++;
      } else {
        restantes.push(item);
      }
    } catch (e) {
      restantes.push(item);
    }
  }

  localStorage.setItem(colaKey, JSON.stringify(restantes));
  return { sincronizados, restantes: restantes.length };
}
