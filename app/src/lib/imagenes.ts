/** Achica y comprime una foto para enviarla (máx. 1800 px, JPEG). Devuelve blob + base64. */
export async function prepararImagen(file: File, maxLado = 1800, calidad = 0.82): Promise<{ blob: Blob; base64: string; media_type: string }> {
  if (file.type === 'application/pdf') {
    const base64 = await aBase64(file)
    return { blob: file, base64, media_type: 'application/pdf' }
  }
  const bmp = await createImageBitmap(file).catch(async () => {
    // Safari viejo: vía <img>
    const url = URL.createObjectURL(file)
    const img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url)
    return img as unknown as ImageBitmap
  })
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * escala), h = Math.round(bmp.height * escala)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  const blob: Blob = await new Promise((ok) => canvas.toBlob((b) => ok(b!), 'image/jpeg', calidad))
  return { blob, base64: await aBase64(blob), media_type: 'image/jpeg' }
}

function aBase64(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1])
    r.onerror = mal
    r.readAsDataURL(b)
  })
}
