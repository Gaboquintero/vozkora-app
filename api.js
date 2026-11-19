// =========================================================================
// VOZKORA CONTASOFT + IA — CONECTOR AL PUENTE RENDER + MODO OFFLINE
// =========================================================================
const VOZKORA_CONFIG = {
  PUENTE_URL: 'https://vozkora-puente-contifico.onrender.com',
  EMPRESA_ID: '1b4f7aed-9583-4853-bcda-bf98c3d7f250', // ID de pruebas en Supabase
  STORAGE_KEYS: {
    PRODUCTOS: 'vozkora_cache_productos',
    CLIENTES: 'vozkora_cache_clientes',
    COLA_OFFLINE: 'vozkora_cola_pendientes'
  }
};

// 1. Verificar si hay conexión con el puente Render
async function verificarConexionPuente() {
  try {
    const resp = await fetch(`${VOZKORA_CONFIG.PUENTE_URL}/`, { method: 'GET' });
    return resp.ok;
  } catch (e) {
    return false;
  }
}

// 2. Sincronizar catálogo de productos (Online -> Guarda en caché | Offline -> Lee de caché)
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

// 3. Emitir factura electrónica o guardarla en cola local si no hay internet
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
    // Sin señal o puente dormido: guarda en cola local para reintentar luego
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

// 4. Sincronizar documentos pendientes cuando regrese el internet
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