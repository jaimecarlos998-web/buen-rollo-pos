// Lee la foto de un remito/factura de compra con IA (visión) y devuelve los datos estructurados.
// Sólo el dueño puede usarla. Requiere el secreto ANTHROPIC_API_KEY en Supabase (Edge Functions → Secrets).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MODELO = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5'

const HERRAMIENTA = {
  name: 'cargar_comprobante',
  description: 'Registra los datos leídos de un remito o factura de compra de un comercio argentino.',
  input_schema: {
    type: 'object',
    properties: {
      proveedor: { type: 'string', description: 'Nombre comercial o razón social del proveedor que emite el comprobante (no el cliente).' },
      nro_comprobante: { type: 'string', description: 'Número de comprobante/remito/factura, tal cual figura.' },
      fecha: { type: 'string', description: 'Fecha del comprobante en formato AAAA-MM-DD. Vacío si no se lee.' },
      tipo: { type: 'string', enum: ['factura_a', 'factura_b', 'factura_c', 'remito', 'presupuesto', 'ticket', 'otro'] },
      iva_discriminado: { type: 'boolean', description: 'true si los precios unitarios NO incluyen IVA y el IVA se suma aparte al final (típico de Factura A).' },
      iva_porcentaje: { type: 'number', description: 'Alícuota de IVA si está discriminado (ej. 21). 0 si no aplica.' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            codigo: { type: 'string', description: 'Código del artículo del proveedor o código de barras (EAN), si figura.' },
            descripcion: { type: 'string', description: 'Descripción completa del artículo tal como figura.' },
            cantidad: { type: 'number', description: 'Cantidad facturada en la unidad del comprobante.' },
            unidades_por_bulto: { type: 'number', description: 'Si la cantidad está en bultos/cajas/packs y se indica cuántas unidades trae cada uno, ese número. Si no, 1.' },
            precio_unitario: { type: 'number', description: 'Precio unitario final por unidad facturada, ya aplicado el descuento del renglón si lo hay. Sin IVA si iva_discriminado es true.' },
            descuento_pct: { type: 'number', description: 'Porcentaje de descuento del renglón, 0 si no hay.' },
            subtotal: { type: 'number', description: 'Importe del renglón tal como figura.' },
            legible: { type: 'boolean', description: 'false si el renglón está borroso o hay dudas sobre cantidad o precio.' },
          },
          required: ['descripcion', 'cantidad', 'precio_unitario'],
        },
      },
      descuento_general_pct: { type: 'number', description: 'Descuento general sobre el total, si existe. 0 si no.' },
      total: { type: 'number', description: 'Total final del comprobante.' },
      observaciones: { type: 'string', description: 'Dudas o advertencias para quien revisa (ej. renglones ilegibles, hojas que parecen faltar).' },
    },
    required: ['items'],
  },
}

const INSTRUCCIONES = `Sos un asistente que digitaliza comprobantes de compra para un comercio de artículos de limpieza en Argentina.
Leé todas las imágenes (pueden ser varias hojas del mismo comprobante) y cargá cada renglón de producto con la herramienta.
- Los números usan formato argentino: punto para miles y coma para decimales ("1.250,50" = 1250.5).
- No inventes renglones. Ignorá subtotales, percepciones, IVA, totales y fletes como si fueran productos.
- Si un renglón no se lee bien, cargalo igual con legible=false y explicalo en observaciones.
- Si los precios unitarios no incluyen IVA (Factura A con IVA discriminado), marcá iva_discriminado=true.
- Respondé únicamente usando la herramienta.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  // Sólo el dueño
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: esDueno, error: e1 } = await supabase.rpc('es_dueno')
  if (e1 || !esDueno) return json({ error: 'Sólo el dueño puede cargar compras' }, 403)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'Falta configurar la clave de IA (ANTHROPIC_API_KEY) en Supabase' }, 500)

  let body: { imagenes?: { media_type: string; data: string }[]; proveedores?: string[] }
  try { body = await req.json() } catch { return json({ error: 'Pedido inválido' }, 400) }
  const imagenes = (body.imagenes ?? []).slice(0, 6)
  if (!imagenes.length) return json({ error: 'No llegó ninguna imagen' }, 400)

  const pista = body.proveedores?.length ? `\nProveedores habituales del comercio (usá el mismo nombre si coincide): ${body.proveedores.join(', ')}.` : ''

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 8000,
      system: INSTRUCCIONES + pista,
      tools: [HERRAMIENTA],
      tool_choice: { type: 'tool', name: HERRAMIENTA.name },
      messages: [{
        role: 'user',
        content: [
          ...imagenes.map((img) => img.media_type === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: img.data } }
            : { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } }),
          { type: 'text', text: 'Digitalizá este comprobante de compra.' },
        ],
      }],
    }),
  })
  if (!r.ok) {
    const t = await r.text()
    console.error('Anthropic', r.status, t)
    return json({ error: r.status === 401 ? 'La clave de IA no es válida' : r.status === 429 || r.status === 529 ? 'El servicio de IA está ocupado, probá en un minuto' : `Error al leer la foto (${r.status})` }, 502)
  }
  const res = await r.json()
  const uso = res.content?.find((c: { type: string }) => c.type === 'tool_use')
  if (!uso) return json({ error: 'No se pudo interpretar el comprobante' }, 422)
  return json({ comprobante: uso.input, uso_tokens: res.usage })
})
