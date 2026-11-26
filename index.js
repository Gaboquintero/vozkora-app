require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Conexión con Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CONTIFICO_BASE_URL = 'https://base.contifico.com/sistema/api/v1';

// 1. Ruta de salud para verificar que el servidor puente está activo
app.get('/', (req, res) => {
  res.json({
    estado: 'OK',
    servicio: 'Vozkora ContaSoft + IA - Puente Siigo Contífico Ecuador',
    version: '1.1.0'
  });
});

// 2. Obtener llaves de Contífico de una empresa registrada en Supabase
async function obtenerCredencialesEmpresa(empresaId) {
  let { data } = await supabase
    .from('vozkora_empresas')
    .select('contifico_api_key, contifico_pos_token, entorno, activa')
    .eq('id', empresaId)
    .maybeSingle();

  if (data) {
    if (data.activa === false) throw new Error('Empresa suspendida en Vozkora');
    if (!data.contifico_api_key) throw new Error('La empresa aún no configura su API Key en Vozkora CRM');
    return {
      contifico_api_key: data.contifico_api_key,
      contifico_api_token: data.contifico_pos_token || '',
      ambiente_sri: data.entorno || 'SANDBOX',
      estado_cuenta: data.activa ? 'ACTIVO' : 'SUSPENDIDO'
    };
  }

  const legacy = await supabase
    .from('empresas')
    .select('contifico_api_key, contifico_api_token, ambiente_sri, estado_cuenta')
    .eq('id', empresaId)
    .single();

  if (legacy.error) throw new Error(legacy.error.message);
  if (!legacy.data) throw new Error('Empresa no encontrada en Supabase');
  if (legacy.data.estado_cuenta !== 'ACTIVO') throw new Error('Cuenta suspendida o vencida');
  if (!legacy.data.contifico_api_key) throw new Error('La empresa aún no configura su API Key de Contífico');
  return legacy.data;
}

// 3. Leer Productos desde Siigo Contífico
app.get('/api/contifico/:empresaId/productos', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const respuesta = await axios.get(`${CONTIFICO_BASE_URL}/producto/`, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, total: respuesta.data.length, productos: respuesta.data });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.response?.data || err.message });
  }
});

// 4. Leer Clientes / Personas desde Siigo Contífico
app.get('/api/contifico/:empresaId/clientes', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const respuesta = await axios.get(`${CONTIFICO_BASE_URL}/persona/`, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    const lista = Array.isArray(respuesta.data) ? respuesta.data : [];
    const clientes = lista.filter(p => p && (p.es_cliente !== false));
    res.json({ ok: true, total: clientes.length, clientes });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.response?.data || err.message });
  }
});

// 5. Leer Catálogo de Impuestos SRI desde Siigo Contífico
app.get('/api/contifico/:empresaId/impuestos', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const respuesta = await axios.get(`${CONTIFICO_BASE_URL}/impuesto/`, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, impuestos: respuesta.data });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.response?.data || err.message });
  }
});

// 5B. Leer Categorías de Productos desde Contífico
app.get('/api/contifico/:empresaId/categorias', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const respuesta = await axios.get(`${CONTIFICO_BASE_URL}/categoria/`, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, categorias: Array.isArray(respuesta.data) ? respuesta.data : [] });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.response?.data || err.message });
  }
});

// 5C. Leer Bodegas reales desde Contífico
app.get('/api/contifico/:empresaId/bodegas', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const respuesta = await axios.get(`${CONTIFICO_BASE_URL}/bodega/`, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, bodegas: Array.isArray(respuesta.data) ? respuesta.data : [] });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.response?.data || err.message });
  }
});

// 5D. Crear o Actualizar Producto en Contífico
app.post('/api/contifico/:empresaId/producto', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const respuesta = await axios.post(`${CONTIFICO_BASE_URL}/producto/`, req.body, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, producto: respuesta.data });
  } catch (err) {
    const status = err.response?.status || 400;
    res.status(status).json({
      ok: false,
      error: 'Error al crear producto en Contífico',
      detalle: err.response?.data || err.message
    });
  }
});

app.put('/api/contifico/:empresaId/producto', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const prodId = req.body && req.body.id ? String(req.body.id).trim() : '';
    const url = prodId
      ? `${CONTIFICO_BASE_URL}/producto/${encodeURIComponent(prodId)}/`
      : `${CONTIFICO_BASE_URL}/producto/`;
    const method = prodId ? 'patch' : 'put';
    const respuesta = await axios({
      method,
      url,
      data: req.body,
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, producto: respuesta.data });
  } catch (err) {
    const status = err.response?.status || 400;
    res.status(status).json({
      ok: false,
      error: 'Error al actualizar producto en Contífico',
      detalle: err.response?.data || err.message
    });
  }
});

// 5E. Registrar Movimiento de Inventario (Ingreso ING a Bodega específica)
app.post('/api/contifico/:empresaId/movimiento-inventario', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const payload = Object.assign({}, req.body);

    if (!payload.bodega_id) {
      const bodResp = await axios.get(`${CONTIFICO_BASE_URL}/bodega/`, {
        headers: { Authorization: creds.contifico_api_key },
        timeout: 12000
      });
      const listBod = Array.isArray(bodResp.data) ? bodResp.data : [];
      const foundBod = listBod.find(b =>
        payload.bodega_nombre && String(b.nombre || '').toLowerCase().includes(String(payload.bodega_nombre).toLowerCase())
      ) || listBod[0];
      if (foundBod && foundBod.id) payload.bodega_id = foundBod.id;
    }

    if (!payload.producto_id && payload.codigo_producto) {
      const prResp = await axios.get(`${CONTIFICO_BASE_URL}/producto/?codigo=${encodeURIComponent(payload.codigo_producto)}`, {
        headers: { Authorization: creds.contifico_api_key },
        timeout: 12000
      });
      const listPr = Array.isArray(prResp.data) ? prResp.data : [];
      const foundPr = listPr.find(p => String(p.codigo || '').toUpperCase() === String(payload.codigo_producto).toUpperCase()) || listPr[0];
      if (foundPr && foundPr.id) payload.producto_id = foundPr.id;
    }

    const movBody = {
      tipo: payload.tipo || 'ING',
      fecha: payload.fecha || formatearFechaSriDDMMYYYY(new Date()),
      bodega_id: payload.bodega_id,
      detalles: [
        {
          producto_id: payload.producto_id,
          cantidad: Number(payload.cantidad) || 1,
          precio: Number(payload.precio) || 0
        }
      ],
      descripcion: payload.descripcion || 'Ingreso automático desde Vozkora App'
    };

    const respuesta = await axios.post(`${CONTIFICO_BASE_URL}/movimiento-inventario/`, movBody, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, movimiento: respuesta.data });
  } catch (err) {
    const status = err.response?.status || 400;
    res.status(status).json({
      ok: false,
      error: 'Error registrando movimiento de inventario en bodega',
      detalle: err.response?.data || err.message
    });
  }
});

// 6. Prueba directa con API Key temporal
app.post('/api/contifico/probar-conexion', async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ ok: false, error: 'Falta apiKey' });
    const respuesta = await axios.get(`${CONTIFICO_BASE_URL}/producto/?limit=5`, {
      headers: { Authorization: apiKey }
    });
    res.json({
      ok: true,
      mensaje: 'Conexión exitosa con Siigo Contífico Ecuador',
      muestra_productos: respuesta.data.length
    });
  } catch (err) {
    res.status(401).json({
      ok: false,
      error: 'API Key inválida o sin acceso a Contífico',
      detalle: err.response?.data || err.message
    });
  }
});

// 7. Prueba rápida directa desde el navegador web
app.get('/probar-navegador', async (req, res) => {
  try {
    const apiKey = req.query.key;
    if (!apiKey) return res.status(400).json({ ok: false, error: 'Falta ?key= en la URL' });
    const respuesta = await axios.get(`${CONTIFICO_BASE_URL}/producto/?limit=5`, {
      headers: { Authorization: apiKey },
      timeout: 8000
    });
    res.json({
      ok: true,
      mensaje: '¡Conexión real exitosa con Siigo Contífico Ecuador!',
      productos_encontrados: respuesta.data.length,
      ejemplo_productos: respuesta.data
    });
  } catch (err) {
    res.status(401).json({
      ok: false,
      error: 'Error al conectar con Contífico',
      detalle: err.response?.data || err.message
    });
  }
});

// 8. Prueba completa leyendo credenciales desde Supabase por ID de empresa
app.get('/probar-empresa/:id', async (req, res) => {
  try {
    const empresa = await obtenerCredencialesEmpresa(req.params.id);
    if (!empresa || !empresa.contifico_api_key) {
      return res.status(404).json({ ok: false, error: 'Empresa no encontrada en Supabase' });
    }
    const respuesta = await axios.get(`${CONTIFICO_BASE_URL}/bodega/`, {
      headers: { Authorization: empresa.contifico_api_key },
      timeout: 25000
    });
    res.json({
      ok: true,
      mensaje: '¡Puente Render + Supabase + Siigo Contífico conectado!',
      productos: respuesta.data
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: 'Error en prueba completa',
      detalle: err.response?.data || err.message
    });
  }
});

// -------------------------------------------------------------------------
// HELPER: CONTROL DE FECHAS OFFLINE SRI (REGLA 8)
// -------------------------------------------------------------------------
function formatearFechaSriDDMMYYYY(dateObj) {
  const d = new Date(dateObj);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function normalizarFechaYObservacionSri(fechaOperacionReal, descripcionActual = '') {
  const ahora = new Date();
  const hoyStr = formatearFechaSriDDMMYYYY(ahora);
  if (!fechaOperacionReal) {
    return { fechaEmisionSri: hoyStr, observacionFinal: descripcionActual, reprogramadaPorContingencia: false };
  }
  const fechaRealSoloDia = String(fechaOperacionReal).trim().split(' ')[0];
  if (fechaRealSoloDia && fechaRealSoloDia !== hoyStr) {
    const notaRuta = `Venta realizada en ruta el ${fechaOperacionReal}`;
    const observacionFinal = descripcionActual
      ? `${descripcionActual} | ${notaRuta}`
      : notaRuta;
    return { fechaEmisionSri: hoyStr, observacionFinal, reprogramadaPorContingencia: true };
  }
  return {
    fechaEmisionSri: fechaRealSoloDia || hoyStr,
    observacionFinal: descripcionActual,
    reprogramadaPorContingencia: false
  };
}

// 9. Crear o Actualizar Cliente en Siigo Contífico (con búsqueda de ID existente por RUC/CI)
app.post('/api/contifico/:empresaId/cliente', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const respuesta = await axios.post(`${CONTIFICO_BASE_URL}/persona/`, req.body, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, cliente: respuesta.data });
  } catch (err) {
    const status = err.response?.status || 400;
    res.status(status).json({
      ok: false,
      error: 'Error al registrar cliente en Contífico',
      detalle: err.response?.data || err.message
    });
  }
});

app.put('/api/contifico/:empresaId/cliente', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const body = Object.assign({}, req.body || {});
    let personaId = body.id ? String(body.id).trim() : '';

    // Buscar el ID interno de Contífico por RUC o Cédula para hacer PATCH exacto
    if (!personaId && (body.ruc || body.cedula)) {
      const ident = String(body.ruc || body.cedula).trim();
      const param = body.ruc ? `ruc=${encodeURIComponent(ident)}` : `cedula=${encodeURIComponent(ident)}`;
      const searchResp = await axios.get(`${CONTIFICO_BASE_URL}/persona/?${param}`, {
        headers: { Authorization: creds.contifico_api_key },
        timeout: 12000
      }).catch(() => ({ data: [] }));
      const matches = Array.isArray(searchResp.data) ? searchResp.data : [];
      if (matches.length > 0 && matches[0].id) {
        personaId = String(matches[0].id);
      }
    }

    const url = personaId
      ? `${CONTIFICO_BASE_URL}/persona/${encodeURIComponent(personaId)}/`
      : `${CONTIFICO_BASE_URL}/persona/`;
    const method = personaId ? 'patch' : 'put';

    const respuesta = await axios({
      method,
      url,
      data: body,
      headers: { Authorization: creds.contifico_api_key },
      timeout: 15000
    });
    res.json({ ok: true, cliente: respuesta.data });
  } catch (err) {
    const status = err.response?.status || 400;
    res.status(status).json({
      ok: false,
      error: 'Error al actualizar cliente en Contífico',
      detalle: err.response?.data || err.message
    });
  }
});

// 10. Emitir Documento (Factura / Proforma / Nota de Crédito) con Regla 8 SRI
app.post('/api/contifico/:empresaId/documento', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const payload = Object.assign({}, req.body);
    const { fechaEmisionSri, observacionFinal, reprogramadaPorContingencia } = normalizarFechaYObservacionSri(
      payload.fecha_operacion_real,
      payload.descripcion || payload.observaciones || ''
    );
    payload.fecha_emision = fechaEmisionSri;
    if (observacionFinal) {
      payload.descripcion = observacionFinal;
    }

    const respuesta = await axios.post(`${CONTIFICO_BASE_URL}/documento/`, payload, {
      headers: { Authorization: creds.contifico_api_key },
      timeout: 20000
    });

    res.json({
      ok: true,
      fecha_emision_aplicada: fechaEmisionSri,
      reprogramada_por_contingencia: reprogramadaPorContingencia,
      observacion_aplicada: observacionFinal,
      documento: respuesta.data
    });
  } catch (err) {
    const status = err.response?.status || 400;
    res.status(status).json({
      ok: false,
      error: 'Rechazo de Siigo Contífico / SRI',
      detalle: err.response?.data || err.message
    });
  }
});

// 10B. Endpoint Consolidado Gerencial y Financiero
app.get('/api/contifico/:empresaId/resumen-gerencial', async (req, res) => {
  try {
    const creds = await obtenerCredencialesEmpresa(req.params.empresaId);
    const [docsResp, persResp, prodResp] = await Promise.allSettled([
      axios.get(`${CONTIFICO_BASE_URL}/documento/`, { headers: { Authorization: creds.contifico_api_key }, timeout: 15000 }),
      axios.get(`${CONTIFICO_BASE_URL}/persona/`, { headers: { Authorization: creds.contifico_api_key }, timeout: 15000 }),
      axios.get(`${CONTIFICO_BASE_URL}/producto/`, { headers: { Authorization: creds.contifico_api_key }, timeout: 15000 })
    ]);

    const documentos = docsResp.status === 'fulfilled' && Array.isArray(docsResp.value.data) ? docsResp.value.data : [];
    const personas = persResp.status === 'fulfilled' && Array.isArray(persResp.value.data) ? persResp.value.data : [];
    const productos = prodResp.status === 'fulfilled' && Array.isArray(prodResp.value.data) ? prodResp.value.data : [];

    res.json({
      ok: true,
      documentos,
      personas,
      productos
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: 'Error consultando resumen gerencial en Contífico',
      detalle: err.response?.data || err.message
    });
  }
});

// 11. Endpoint Puente Gemini con Guardrail Estricto Contable/Empresarial + Soporte Imagen RUC
app.post('/api/ia/consultar', async (req, res) => {
  try {
    const { prompt, contextoEmpresa, imagen_base64 } = req.body || {};
    const txt = String(prompt || '').trim();
    if (!txt) return res.status(400).json({ ok: false, error: 'Prompt vacío' });

    const offTopic = /(receta|cocina|chiste|poema|canci[oó]n|cuento|hor[oó]scopo|f[uú]tbol|pel[ií]cula|novela|tarea escolar|ensayo|dieta|clima)/i;
    if (offTopic.test(txt)) {
      return res.status(403).json({
        ok: false,
        bloqueado_tema: true,
        error: '⚠️ Vozkora IA está habilitada exclusivamente para operaciones contables, facturación, inventario, cartera y gestión comercial de tu empresa.'
      });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(503).json({
        ok: false,
        origen: 'NO_GEMINI_KEY',
        error: 'GEMINI_API_KEY no configurada en Render'
      });
    }

    const systemInstruction = 'Eres Vozkora IA, consultor gerencial y contable senior especializado en Ecuador (SRI), inventarios multi-bodega, cartera y ventas. Responde con cifras exactas basadas en los datos entregados.';
    const userParts = [{ text: contextoEmpresa ? `Contexto empresa: ${JSON.stringify(contextoEmpresa)}\nConsulta: ${txt}` : txt }];
    if (imagen_base64 && typeof imagen_base64 === 'string') {
      const m = imagen_base64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (m) {
        userParts.push({ inlineData: { mimeType: m[1], data: m[2] } });
      }
    }
    const geminiResp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: userParts }]
      },
      { timeout: 20000 }
    );

    const answer = geminiResp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!answer) {
      return res.status(502).json({ ok: false, error: 'Respuesta vacía de Gemini' });
    }
    res.json({ ok: true, origen: 'GEMINI_CLOUD', respuesta: answer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor puente Vozkora activo en puerto ${PORT}`);
});
