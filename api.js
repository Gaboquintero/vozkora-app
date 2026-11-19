// =========================================================================
// VOZKORA CONTASOFT + IA — CONECTOR SUPABASE + PUENTE RENDER + MODO OFFLINE
// =========================================================================
const VOZKORA_CONFIG = {
  PUENTE_URL: 'https://vozkora-puente-contifico.onrender.com',
  EMPRESA_ID: '1b4f7aed-9583-4853-bcda-bf98c3d7f250',
  SUPABASE_URL: 'https://dgzikmjfozhxdanhnnhx.supabase.co/rest/v1',
  SUPABASE_KEY: 'sb_publishable_HbDtW4JNH1cTpXkqwNUhwg_UnsBP6og',
  STORAGE_KEYS: {
    SESION: 'vozkora_sesion_activa',
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

// -------------------------------------------------------------------------
// A. AUTENTICACIÓN Y GESTIÓN DE USUARIOS / PERMISOS (SUPABASE)
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
    return { ok: false, error: 'Cuenta suspendida. Contacta a soporte Vozkora.' };
  }
  localStorage.setItem(VOZKORA_CONFIG.STORAGE_KEYS.SESION, JSON.stringify(user));
  return { ok: true, user };
}

function obtenerSesionVozkora() {
  try {
    return JSON.parse(localStorage.getItem(VOZKORA_CONFIG.STORAGE_KEYS.SESION) || 'null');
  } catch (e) {
    return null;
  }
}

function cerrarSesionVozkora() {
  localStorage.removeItem(VOZKORA_CONFIG.STORAGE_KEYS.SESION);
}

// -------------------------------------------------------------------------
// B. VOZKORA CONTROL CRM (SÚPER-ADMIN: EMPRESAS, USUARIOS, PERMISOS)
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
// C. SISTEMA DE TICKETS DE ALTA DE USUARIOS / CAMBIOS DE PLAN
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

async function crmActualizarTicket(id, estado) {
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_tickets?id=eq.${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: supaHeaders(),
    body: JSON.stringify({ estado })
  });
  if (!resp.ok) throw new Error('Error actualizando ticket');
  return await resp.json();
}

// -------------------------------------------------------------------------
// D. REPOSITORIO MAESTRO DE AUDITORÍA ("HOJAS TIPO EXCEL" EN SUPABASE)
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
// E. PUENTE RENDER + SIIGO CONTÍFICO + MODO OFFLINE
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
