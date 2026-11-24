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
  ASESOR_VIP_WHATSAPP: '573239399953',
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
    const resp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/refrescar_sesion_vozkora_seguro`, {
      method: 'POST',
      headers: supaHeaders(),
      body: JSON.stringify({ p_email: String(sesionActual.email).trim().toLowerCase() })
    });
    if (!resp.ok) return sesionActual;
    const data = await resp.json();
    if (!data || !data.ok || !data.user) return sesionActual;

    const u = data.user;
    const sesionFresca = Object.assign({}, sesionActual, u, {
      periodicidad: u.periodicidad || 'MENSUAL',
      fecha_proximo_corte: u.fecha_proximo_corte || calcularProximoCorte('MENSUAL'),
      control_corte: u.control_corte !== false,
      exento_hasta: u.exento_hasta || null,
      max_usuarios: Number(u.max_usuarios) || 5,
      sva_elegidos_fijos: !!u.sva_elegidos_fijos
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
  const localDevId = obtenerDeviceIdLocal();
  const devInfo = obtenerNombreDispositivo();

  const resp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/login_vozkora_seguro`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify({
      p_email: cleanEmail,
      p_clave: cleanPass,
      p_device_id: localDevId,
      p_device_info: devInfo
    })
  });
  if (!resp.ok) throw new Error('No se pudo conectar con el servicio de autenticación');
  const data = await resp.json();
  if (!data || !data.ok) {
    return { ok: false, error: (data && data.error) ? data.error : 'Credenciales incorrectas.' };
  }

  const sesionCompleta = Object.assign({}, data.user, {
    periodicidad: data.user.periodicidad || 'MENSUAL',
    fecha_proximo_corte: data.user.fecha_proximo_corte || calcularProximoCorte('MENSUAL'),
    control_corte: data.user.control_corte !== false,
    exento_hasta: data.user.exento_hasta || null,
    max_usuarios: Number(data.user.max_usuarios) || 5,
    sva_elegidos_fijos: !!data.user.sva_elegidos_fijos,
    session_token: localDevId
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
      await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/logout_vozkora_seguro`, {
        method: 'POST',
        headers: supaHeaders(),
        body: JSON.stringify({ p_user_id: ses.id })
      });
    } catch (e) {}
  }
  localStorage.removeItem(VOZKORA_CONFIG.STORAGE_KEYS.SESION);
}

async function registrarInteresModuloVozkora(moduloNombre) {
  const ses = obtenerSesionVozkora() || {};
  const empRuc = ses.empresa_ruc || 'N/A';
  const empNom = ses.empresa_nombre || 'Empresa Vozkora';
  const userMail = ses.email || 'usuario@empresa.com';
  const modLabel = moduloNombre || 'Módulo Empresarial';

  try {
    const rpcResp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/registrar_interes_modulo_vozkora`, {
      method: 'POST',
      headers: supaHeaders(),
      keepalive: true,
      body: JSON.stringify({
        p_empresa_ruc: empRuc,
        p_empresa_nombre: empNom,
        p_email: userMail,
        p_modulo_nombre: modLabel
      })
    });
    if (rpcResp.ok) return true;
  } catch (e) {}

  // Respaldo directo a tabla vozkora_tickets si el RPC fallara
  try {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fechaStr = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const insResp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_tickets`, {
      method: 'POST',
      headers: supaHeaders(),
      keepalive: true,
      body: JSON.stringify({
        empresa_ruc: empRuc,
        empresa_nombre: empNom,
        solicitado_por: userMail,
        tipo_solicitud: 'CONSULTA_CANAL_TECNICO',
        estado: 'PENDIENTE',
        detalle: {
          categoria: '📲 Consulta Canal Técnico WhatsApp',
          modulo_consultado: modLabel,
          telefono_contacto: ses.empresa_telefono || 'N/A',
          descripcion: `El cliente tocó "Consultar con Canal Técnico WhatsApp" desde el módulo: ${modLabel}`,
          historial: [
            {
              fecha: fechaStr,
              de_estado: 'NUEVO',
              a_estado: '🟡 Abierto',
              motivo: `Lead generado en vivo al abrir WhatsApp desde ${modLabel}`,
              autor: userMail
            }
          ]
        }
      })
    });
    return insResp.ok;
  } catch (e2) {
    return false;
  }
}

// -------------------------------------------------------------------------
// L. FUNCIONES CRM PARA COLABORADORES (SOPORTE / VENTAS) Y HOJA DE VIDA 360°
// -------------------------------------------------------------------------
async function crmListarColaboradoresInternos() {
  const all = await crmListarUsuarios();
  return all.filter(u => ['SUPERADMIN', 'SOPORTE', 'VENTAS'].includes(String(u.rol || '').toUpperCase()));
}

async function crmAsignarTicketAColaborador(ticketId, colaboradorEmail, colaboradorNombre, detalleActual = {}) {
  const nuevoDetalle = Object.assign({}, detalleActual, {
    asignado_a_email: colaboradorEmail || '',
    asignado_a_nombre: colaboradorNombre || 'Sin asignar'
  });
  const url = `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_tickets?id=eq.${encodeURIComponent(ticketId)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: supaHeaders(),
    body: JSON.stringify({
      asignado_a: colaboradorEmail || null,
      detalle: nuevoDetalle
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.message || 'Error asignando ticket');
  return Array.isArray(data) ? data[0] : data;
}

async function crmObtenerHojaVidaCliente360(empresaRuc) {
  if (!empresaRuc) return { facturas: [], proformas: [], cobros: [], notasCredito: [], ordenes: [], clientes: [] };
  const safeFetch = async (tabla) => {
    try {
      const r = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/${tabla}?empresa_ruc=eq.${encodeURIComponent(empresaRuc)}&select=*&order=creado_en.desc&limit=100`, {
        headers: supaHeaders()
      });
      return r.ok ? await r.json() : [];
    } catch (e) {
      return [];
    }
  };
  const [facturas, proformas, cobros, notasCredito, ordenes, clientes] = await Promise.all([
    safeFetch('repo_facturas'),
    safeFetch('repo_proformas'),
    safeFetch('repo_cobros'),
    safeFetch('repo_notas_credito'),
    safeFetch('repo_ordenes_trabajo'),
    safeFetch('repo_clientes')
  ]);
  return { facturas, proformas, cobros, notasCredito, ordenes, clientes };
}

async function solicitarEliminacionCuentaVozkora(motivo = '') {
  const ses = obtenerSesionVozkora() || {};
  const resp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/solicitar_eliminacion_cuenta_vozkora`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify({
      p_empresa_ruc: ses.empresa_ruc || 'N/A',
      p_empresa_nombre: ses.empresa_nombre || 'Empresa Vozkora',
      p_email: ses.email || 'usuario@empresa.com',
      p_motivo: motivo || 'Solicitud desde aplicación móvil'
    })
  });
  if (!resp.ok) throw new Error('No se pudo registrar la solicitud de eliminación');
  return true;
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
// C. VOZKORA CONTROL CRM — GESTIÓN BLINDADA DE USUARIOS POR RPC SEGURO
// -------------------------------------------------------------------------
function obtenerCredencialesAdminCrm() {
  const ses = obtenerSesionVozkora() || {};
  return {
    p_admin_email: String(ses.email || '').trim().toLowerCase(),
    p_admin_rol: String(ses.rol || '').trim().toUpperCase()
  };
}

async function crmListarUsuarios() {
  const auth = obtenerCredencialesAdminCrm();
  const resp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/crm_listar_usuarios_seguro`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(auth)
  });
  if (!resp.ok) throw new Error('Error listando usuarios');
  const rows = await resp.json();
  return Array.isArray(rows) ? rows : [];
}

async function crmCrearUsuario(payload) {
  const auth = obtenerCredencialesAdminCrm();
  const resp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/crm_crear_usuario_seguro`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(Object.assign({}, auth, { p_payload: payload }))
  });
  const data = await resp.json();
  if (!resp.ok || (data && data.ok === false)) {
    throw new Error((data && (data.error || data.message)) || 'Error creando usuario');
  }
  return data && data.user ? data.user : data;
}

async function crmActualizarUsuario(id, campos) {
  const auth = obtenerCredencialesAdminCrm();
  const resp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/crm_actualizar_usuario_seguro`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(Object.assign({}, auth, { p_user_id: id, p_campos: campos }))
  });
  const data = await resp.json();
  if (!resp.ok || (data && data.ok === false)) {
    throw new Error((data && (data.error || data.message)) || 'Error actualizando usuario');
  }
  return data && data.user ? data.user : data;
}

async function crmEliminarUsuario(id) {
  const auth = obtenerCredencialesAdminCrm();
  const resp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/crm_eliminar_usuario_seguro`, {
    method: 'POST',
    headers: supaHeaders(),
    body: JSON.stringify(Object.assign({}, auth, { p_user_id: id }))
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || (data && data.ok === false)) {
    throw new Error((data && (data.error || data.message)) || 'Error eliminando usuario');
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
// G. PUENTE RENDER + PROVEEDOR SOFTWARE CONTABLE + MODO OFFLINE
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
  const ses = obtenerSesionVozkora();
  const empId = (ses && ses.empresa_id) ? ses.empresa_id : VOZKORA_CONFIG.EMPRESA_ID;
  const empRuc = (ses && ses.empresa_ruc) ? ses.empresa_ruc : '123456789001';
  const cacheKey = `${VOZKORA_CONFIG.STORAGE_KEYS.PRODUCTOS}_${empRuc}`;
  try {
    const resp = await fetch(
      `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${encodeURIComponent(empId)}/productos`
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

async function obtenerCategoriasVozkora() {
  const ses = obtenerSesionVozkora();
  const empId = (ses && ses.empresa_id) ? ses.empresa_id : VOZKORA_CONFIG.EMPRESA_ID;
  const empRuc = (ses && ses.empresa_ruc) ? ses.empresa_ruc : '123456789001';
  const cacheKey = `vozkora_cache_categorias_${empRuc}`;
  try {
    const resp = await fetch(`${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${encodeURIComponent(empId)}/categorias`);
    const data = await resp.json();
    if (data.ok && Array.isArray(data.categorias)) {
      localStorage.setItem(cacheKey, JSON.stringify(data.categorias));
      return { origen: 'ONLINE', categorias: data.categorias };
    }
    throw new Error(data.error || 'Error leyendo categorías');
  } catch (err) {
    const locales = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    return { origen: 'OFFLINE', categorias: locales };
  }
}

async function obtenerBodegasVozkora() {
  const ses = obtenerSesionVozkora();
  const empId = (ses && ses.empresa_id) ? ses.empresa_id : VOZKORA_CONFIG.EMPRESA_ID;
  const empRuc = (ses && ses.empresa_ruc) ? ses.empresa_ruc : '123456789001';
  const cacheKey = `vozkora_cache_bodegas_${empRuc}`;
  try {
    const resp = await fetch(`${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${encodeURIComponent(empId)}/bodegas`);
    const data = await resp.json();
    if (data.ok && Array.isArray(data.bodegas)) {
      localStorage.setItem(cacheKey, JSON.stringify(data.bodegas));
      return { origen: 'ONLINE', bodegas: data.bodegas };
    }
    throw new Error(data.error || 'Error leyendo bodegas');
  } catch (err) {
    const locales = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    return { origen: 'OFFLINE', bodegas: locales };
  }
}

async function registrarMovimientoInventarioContifico(movPayload) {
  const ses = obtenerSesionVozkora();
  const empId = (ses && ses.empresa_id) ? ses.empresa_id : VOZKORA_CONFIG.EMPRESA_ID;
  if (!ses || ses.rol === 'DEMO' || ses.entorno === 'DEMO') {
    return { ok: true, simulated: true, status: 200, data: { mensaje: 'Movimiento simulado en Demo' } };
  }
  const endpoint = `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${encodeURIComponent(empId)}/movimiento-inventario`;
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(movPayload)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      const detalleTec = data.error || data.mensaje || data.message || '';
      const msg = traducirErrorApiContable(resp.status, detalleTec, 'movimiento de bodega');
      return { ok: false, status: resp.status, error: msg, data };
    }
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: traducirErrorApiContable(0, e.message, 'movimiento de bodega') };
  }
}

async function sincronizarProductoPuenteContifico(productoPayload, esEdicion = false) {
  const ses = obtenerSesionVozkora();
  const empId = (ses && ses.empresa_id) ? ses.empresa_id : VOZKORA_CONFIG.EMPRESA_ID;
  if (!ses || ses.rol === 'DEMO' || ses.entorno === 'DEMO') {
    return { ok: true, simulated: true, status: 200, data: { mensaje: 'Modo Demo local' } };
  }
  const endpoint = `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${encodeURIComponent(empId)}/producto`;
  try {
    const resp = await fetch(endpoint, {
      method: esEdicion ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(productoPayload)
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      const detalleTec = data.error || data.mensaje || data.message || '';
      const msg = traducirErrorApiContable(resp.status, detalleTec, 'producto');
      return { ok: false, status: resp.status, error: msg, data };
    }
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: traducirErrorApiContable(0, e.message, 'producto') };
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
  if (!ses || ses.rol === 'DEMO' || ses.entorno === 'DEMO') {
    return { ok: true, simulated: true, status: 200, data: { mensaje: 'Modo Demo local' } };
  }
  const endpoint = `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${encodeURIComponent(empId)}/cliente`;
  try {
    const resp = await fetch(endpoint, {
      method: esEdicion ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clientePayload)
    });
    const data = await resp.json().catch(() => ({}));
    const rawDetail = String(data.error || data.mensaje || data.message || JSON.stringify(data || {}));

    // Detectar si el cliente/persona ya existía previamente en el Proveedor Software Contable
    if (!esEdicion && !resp.ok && /(ya\s+existe|already\s+exists|duplicad|registrad[oa]\s+previamente|ruc\s+existente|c[eé]dula\s+existente)/i.test(rawDetail)) {
      return {
        ok: true,
        alreadyExists: true,
        status: resp.status,
        mensaje: 'Cliente ya creado en el Proveedor Software Contable',
        data
      };
    }

    if (!resp.ok || data.ok === false) {
      const detalleTec = data.error || data.mensaje || data.message || '';
      const msg = traducirErrorApiContable(resp.status, detalleTec, 'cliente');
      return { ok: false, status: resp.status, error: msg, data };
    }
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: traducirErrorApiContable(0, e.message, 'cliente') };
  }
}

// -------------------------------------------------------------------------
// G1B. EXTRACCIÓN INTELIGENTE DE CERTIFICADO RUC (PDF O FOTO) CON IA EN NUBE
// -------------------------------------------------------------------------
async function extraerDatosRucConIA({ textoPdf = '', imagenBase64 = '' }) {
  const ses = obtenerSesionVozkora();
  const empId = (ses && ses.empresa_id) ? ses.empresa_id : VOZKORA_CONFIG.EMPRESA_ID;
  const endpoint = `${VOZKORA_CONFIG.PUENTE_URL}/api/ia/consultar`;
  const prompt = [
    'Eres un extractor contable de certificados RUC del SRI de Ecuador.',
    'Analiza el texto o imagen adjunta y devuelve EXCLUSIVAMENTE un objeto JSON válido sin markdown ni explicaciones con estas claves exactas:',
    '{"ruc":"","cedula":"","tipo_persona":"Natural|Juridica","razon_social":"","nombre_comercial":"","direccion":"","contribuyente_especial":false,"estado":"Activo"}',
    'Reglas:',
    '- Si el documento dice "Apellidos y nombres" o "PERSONAS NATURALES", tipo_persona debe ser "Natural", razon_social los apellidos y nombres completos, y cedula los primeros 10 dígitos del RUC.',
    '- Si dice "Razón Social" o "SOCIEDADES", tipo_persona debe ser "Juridica".',
    '- Extrae la dirección completa del domicilio tributario (provincia, cantón, parroquia, calle, número, referencia).',
    '- Si un campo no aparece, déjalo como "" (o false en contribuyente_especial).',
    textoPdf ? ('\nTEXTO EXTRAÍDO DEL PDF RUC:\n' + String(textoPdf).slice(0, 4500)) : ''
  ].join('\n');

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresa_id: empId,
        prompt,
        imagen_base64: imagenBase64 || undefined
      })
    });
    const data = await resp.json().catch(() => ({}));
    const rawOut = String(data.respuesta || data.texto || data.resultado || (typeof data === 'string' ? data : JSON.stringify(data)));
    const jsonMatch = rawOut.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && (parsed.ruc || parsed.razon_social || parsed.direccion)) {
        return { ok: true, datos: parsed };
      }
    }
    return { ok: false, error: 'La IA no devolvió estructura JSON legible.' };
  } catch (e) {
    return { ok: false, error: e.message || 'Sin respuesta del servicio IA' };
  }
}



// -------------------------------------------------------------------------
// G2. EMISIÓN DE DOCUMENTOS AL PROVEEDOR SOFTWARE CONTABLE
//     CON TRADUCCIÓN CONTABLE DE ERRORES HTTP (REGLA 7) Y FECHA OFFLINE SRI (REGLA 8)
// -------------------------------------------------------------------------
function traducirErrorApiContable(status, detalleTecnico = '', contexto = 'documento') {
  const cleanDet = String(detalleTecnico || '')
    .replace(/siigo\s*cont[ií]fico/gi, 'Proveedor Software Contable')
    .replace(/cont[ií]fico/gi, 'Proveedor Software Contable')
    .trim();
  const extra = cleanDet ? ` Detalle técnico: ${cleanDet}` : '';

  if (status === 400) {
    return `Error 400 — Datos incompletos o con formato incorrecto al enviar al Proveedor Software Contable. Revisa RUC/cédula del cliente, productos, impuestos o forma de pago.${extra}`;
  }
  if (status === 401 || status === 403) {
    return `Error ${status} — Credenciales API del Proveedor Software Contable no configuradas, inválidas o sin permisos. Verifica el API Key y Token POS de la empresa.${extra}`;
  }
  if (status === 404) {
    return `Error 404 — Ruta o recurso no encontrado en el servidor puente del Proveedor Software Contable (verifica si el cliente o producto existe en el sistema contable).${extra}`;
  }
  if (status === 422) {
    return `Error 422 — Validación tributaria/contable rechazada por el Proveedor Software Contable (ej. RUC/cédula inválido, establecimiento no autorizado o producto sin código).${extra}`;
  }
  if (status >= 500) {
    return `Error ${status} — Falla temporal en el servidor del Proveedor Software Contable o puente de comunicación. Tu operación está a salvo; intenta reenviar en unos minutos.${extra}`;
  }
  if (status === 0) {
    return `Sin respuesta del servidor puente del Proveedor Software Contable (conexión interrumpida o servidor despertando).${extra}`;
  }
  return `Error HTTP ${status} al transmitir ${contexto} al Proveedor Software Contable.${extra}`;
}

async function emitirDocumentoPuenteContifico(tipoDoc, docPayload) {
  const ses = obtenerSesionVozkora();
  const empId = (ses && ses.empresa_id) ? ses.empresa_id : VOZKORA_CONFIG.EMPRESA_ID;
  if (!ses || ses.rol === 'DEMO' || ses.entorno === 'DEMO') {
    return { ok: true, simulated: true, status: 200, data: { mensaje: 'Modo Demo local' } };
  }
  const endpoint = `${VOZKORA_CONFIG.PUENTE_URL}/api/contifico/${encodeURIComponent(empId)}/documento`;
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ tipo_documento: tipoDoc }, docPayload))
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      const detalleTec = data.error || data.mensaje || data.message || '';
      const msg = traducirErrorApiContable(resp.status, detalleTec, 'documento');
      return { ok: false, status: resp.status, error: msg, data };
    }
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: traducirErrorApiContable(0, e.message, 'documento') };
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
      fecha_operacion_real: it.fecha_operacion_real || null,
      apiError: it.apiError || null,
      apiErrorStatus: it.apiErrorStatus || null,
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
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(
      `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?select=id&limit=1`,
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
    const timer2 = setTimeout(() => ctrl2.abort(), 4500);
    const resp2 = await fetch(`${VOZKORA_CONFIG.SUPABASE_BASE}/rest/v1/`, {
      method: 'HEAD',
      headers: { 'apikey': VOZKORA_CONFIG.SUPABASE_KEY },
      cache: 'no-store',
      signal: ctrl2.signal
    });
    clearTimeout(timer2);
    return !!resp2;
  } catch (e2) {
    return false;
  }
}

// -------------------------------------------------------------------------
// J. CONTROL ESTRICTO PLAN PILOTO (MÁXIMO 30 DOCUMENTOS O 15 DÍAS)
// -------------------------------------------------------------------------
function obtenerEstadoPilotoLocal(empresaRuc) {
  const ruc = empresaRuc || ((obtenerSesionVozkora() || {}).empresa_ruc) || '123456789001';
  const key = 'vozkora_piloto_uso_' + ruc;
  const todayIso = new Date().toISOString().slice(0, 10);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ruc,
        fechaInicio: parsed.fechaInicio || todayIso,
        docsEmitidos: Number(parsed.docsEmitidos) || 0
      };
    }
  } catch (e) {}
  const initObj = { ruc, fechaInicio: todayIso, docsEmitidos: 0 };
  try { localStorage.setItem(key, JSON.stringify(initObj)); } catch (e) {}
  return initObj;
}

function guardarEstadoPilotoLocal(empresaRuc, fechaInicio, docsEmitidos) {
  const ruc = empresaRuc || ((obtenerSesionVozkora() || {}).empresa_ruc) || '123456789001';
  const key = 'vozkora_piloto_uso_' + ruc;
  const obj = {
    ruc,
    fechaInicio: fechaInicio || new Date().toISOString().slice(0, 10),
    docsEmitidos: Math.max(0, Number(docsEmitidos) || 0)
  };
  try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  return obj;
}

function incrementarDocumentosPilotoLocal(empresaRuc, delta = 1) {
  const st = obtenerEstadoPilotoLocal(empresaRuc);
  return guardarEstadoPilotoLocal(st.ruc, st.fechaInicio, st.docsEmitidos + delta);
}

// -------------------------------------------------------------------------
// K. POLÍTICA DE USO JUSTO ANTI-ABUSO IA (SUPABASE + LOCALSTORAGE)
// -------------------------------------------------------------------------
function obtenerUmbralIaPorPlan(planId) {
  const pid = String(planId || 'piloto').toLowerCase();
  if (pid === 'piloto') return 5;
  if (pid === 'impulso' || pid === 'comercio') return 5000;
  if (pid === 'expansion' || pid === 'dominio') return 15000;
  if (pid === 'enterprise') return 40000;
  return 5000;
}

async function registrarConsumoIaEmpresa(empresaId, empresaRuc, planId) {
  const umbral = obtenerUmbralIaPorPlan(planId);
  const periodoActual = new Date().toISOString().slice(0, 7); // YYYY-MM
  const localKey = 'vozkora_ia_uso_' + (empresaRuc || '123456789001');

  let localData = { periodo: periodoActual, usadas: 0 };
  try {
    const raw = localStorage.getItem(localKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.periodo === periodoActual || String(planId).toLowerCase() === 'piloto') {
        localData = { periodo: parsed.periodo || periodoActual, usadas: Number(parsed.usadas) || 0 };
      }
    }
  } catch (e) {}

  if (localData.usadas >= umbral) {
    return { permitido: false, usadas: localData.usadas, umbral };
  }

  const nuevoValor = localData.usadas + 1;
  try {
    localStorage.setItem(localKey, JSON.stringify({ periodo: periodoActual, usadas: nuevoValor }));
  } catch (e) {}

  if (empresaId && !String(empresaId).startsWith('demo')) {
    try {
      const getResp = await fetch(
        `${VOZKORA_CONFIG.SUPABASE_URL}/vozkora_empresas?id=eq.${encodeURIComponent(empresaId)}&select=consultas_ia_mes,consultas_ia_periodo,plan_activo`,
        { headers: supaHeaders() }
      );
      if (getResp.ok) {
        const rows = await getResp.json();
        if (rows && rows.length > 0) {
          const row = rows[0];
          const isPilot = String(row.plan_activo || planId).toLowerCase() === 'piloto';
          const mismoPeriodo = row.consultas_ia_periodo === periodoActual;
          const baseDb = (isPilot || mismoPeriodo) ? (Number(row.consultas_ia_mes) || 0) : 0;
          const realUmbral = obtenerUmbralIaPorPlan(row.plan_activo || planId);
          if (baseDb >= realUmbral) {
            return { permitido: false, usadas: baseDb, umbral: realUmbral };
          }
          const dbNext = baseDb + 1;
          await crmActualizarEmpresa(empresaId, {
            consultas_ia_mes: dbNext,
            consultas_ia_periodo: periodoActual
          });
          localStorage.setItem(localKey, JSON.stringify({ periodo: periodoActual, usadas: dbNext }));
          return { permitido: true, usadas: dbNext, umbral: realUmbral };
        }
      }
    } catch (e) {}
  }

  return { permitido: true, usadas: nuevoValor, umbral };
}

async function crmReiniciarConsumoIaEmpresa(empresaId, empresaRuc = '') {
  const periodoActual = new Date().toISOString().slice(0, 7);
  if (empresaRuc) {
    try {
      localStorage.setItem('vozkora_ia_uso_' + empresaRuc, JSON.stringify({ periodo: periodoActual, usadas: 0 }));
    } catch (e) {}
  }
  return await crmActualizarEmpresa(empresaId, {
    consultas_ia_mes: 0,
    consultas_ia_periodo: periodoActual
  });
}

// -------------------------------------------------------------------------
// M. INFORME GERENCIAL MULTI-SUCURSAL Y CONTABLE ENTERPRISE (SUPABASE + API)
// -------------------------------------------------------------------------
async function obtenerInformeGerencialVozkora(empresaRuc = '') {
  const ses = obtenerSesionVozkora() || {};
  const ruc = empresaRuc || ses.empresa_ruc || '';
  if (!ruc || ses.rol === 'DEMO' || ses.entorno === 'DEMO') return null;

  const [dbInvoices, dbNC, dbQuotes, dbPayments, prodRes] = await Promise.all([
    consultarRepositorio('repo_facturas', ruc).catch(() => []),
    consultarRepositorio('repo_notas_credito', ruc).catch(() => []),
    consultarRepositorio('repo_proformas', ruc).catch(() => []),
    consultarRepositorio('repo_cobros', ruc).catch(() => []),
    obtenerProductosVozkora().catch(() => null)
  ]);

  const invoices = Array.isArray(dbInvoices) ? dbInvoices.map(f => ({
    id: f.numero_factura,
    date: (f.fecha_operacion_real || f.creado_en || '').slice(0, 10),
    client: f.cliente_nombre,
    subtotal: Number(f.subtotal || 0),
    ivaRate: Number(f.iva_porcentaje || 15),
    ivaAmt: Number(f.iva_monto || 0),
    total: Number(f.total || 0),
    method: f.forma_pago || 'Efectivo',
    commission: Number(((Number(f.subtotal || 0)) * 0.03).toFixed(2)),
    status: f.estado_sri === 'PENDIENTE_OFFLINE' ? 'Pendiente Offline' : 'Autorizada SRI'
  })) : [];

  const creditNotes = Array.isArray(dbNC) ? dbNC.map(n => ({
    id: n.numero_nc,
    invoiceRef: n.factura_referencia,
    client: n.cliente_nombre,
    reason: n.motivo,
    amount: Number(n.monto || 0),
    date: (n.creado_en || '').slice(0, 10)
  })) : [];

  const quotes = Array.isArray(dbQuotes) ? dbQuotes.map(q => ({
    id: q.numero_proforma,
    client: q.cliente_nombre,
    contableSynced: true,
    items: Array.isArray(q.items) ? q.items : [],
    subtotal: Number(q.subtotal || 0),
    discountTotal: 0,
    ivaRate: 15,
    ivaAmt: Number(q.iva_monto || 0),
    total: Number(q.total || 0),
    discountModeLabel: 'Sincronizada',
    converted: false,
    date: (q.creado_en || '').slice(0, 10)
  })) : [];

  const payments = Array.isArray(dbPayments) ? dbPayments.map(p => ({
    name: p.cliente_nombre,
    amount: Number(p.monto || 0),
    method: p.medio_pago || 'Transferencia',
    date: (p.creado_en || '').slice(0, 10)
  })) : [];

  const products = (prodRes && Array.isArray(prodRes.productos) && prodRes.productos.length > 0)
    ? prodRes.productos.map((p, idx) => ({
        id: p.codigo || ('P' + String(idx + 1).padStart(3, '0')),
        barcode: (p.codigo_barra || p.codigo_barras || '').trim(),
        name: p.nombre || 'Producto',
        price: Number(p.pvp1 || 0) || 1.00,
        cost: Number(p.costo_promedio || ((Number(p.pvp1 || 0) || 1.00) * 0.72)).toFixed(2) * 1,
        stock: Number(p.cantidad_stock ?? 0),
        warehouse: 'Bodega Principal',
        ivaRate: Number(p.porcentaje_iva ?? 15),
        keywords: [(p.nombre || 'producto').toLowerCase().split(' ')[0]]
      }))
    : [];

  return { invoices, creditNotes, quotes, payments, products };
}

// -------------------------------------------------------------------------
// N. ADMINISTRADOR DE ÓRDENES DE TRABAJO (TALLER) POR EMPRESA (repo_ordenes_trabajo)
// -------------------------------------------------------------------------
async function empresaListarUsuariosCompaneros(empresaRuc = '') {
  const ses = obtenerSesionVozkora() || {};
  const ruc = empresaRuc || ses.empresa_ruc || '';
  if (!ruc) return [];
  if (ses.rol === 'DEMO' || ses.entorno === 'DEMO') {
    return [
      { id: 'u1', email: ses.email || 'admin@demo.com', nombre_completo: 'Administrador Principal', rol: 'ADMIN_EMPRESA', activo: true },
      { id: 'u2', email: 'tecnico1@demo.com', nombre_completo: 'Carlos Paredes (Técnico Taller)', rol: 'OPERADOR', activo: true },
      { id: 'u3', email: 'tecnico2@demo.com', nombre_completo: 'María Fernanda Ruiz (Soporte Campo)', rol: 'OPERADOR', activo: true }
    ];
  }
  try {
    const resp = await fetch(`${VOZKORA_CONFIG.SUPABASE_URL}/rpc/empresa_listar_usuarios_seguro`, {
      method: 'POST',
      headers: supaHeaders(),
      body: JSON.stringify({
        p_empresa_ruc: ruc,
        p_solicitante_email: String(ses.email || '').trim().toLowerCase()
      })
    });
    if (!resp.ok) return [];
    const rows = await resp.json();
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}

async function empresaActualizarOrdenTrabajoRepositorio(empresaRuc, codigoOrden, campos) {
  if (!empresaRuc || !codigoOrden) return false;
  try {
    const url = `${VOZKORA_CONFIG.SUPABASE_URL}/repo_ordenes_trabajo?empresa_ruc=eq.${encodeURIComponent(empresaRuc)}&codigo_orden=eq.${encodeURIComponent(codigoOrden)}`;
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
