# Buen Rollo · Punto de venta

App para el celular (se instala desde el navegador) para vender, controlar stock, cargar compras y comparar precios de proveedores. Los datos viven en **Supabase** y se sincronizan con **Google Sheets** en los dos sentidos.

**App:** https://jaimecarlos998-web.github.io/buen-rollo-pos/

## Qué hace

| Pantalla | Quién | Para qué |
|---|---|---|
| Vender | Todos | Buscar o escanear con la cámara → carrito → medio de pago → confirmar. Funciona sin señal (guarda la venta y la envía después). |
| Stock | Todos (el dueño ve costos y edita) | Stock actual, a reponer, negativos, sin precio, margen bajo. Historial de precios por producto. |
| Ventas | Dueño: todas · Empleados: las suyas | Ventas del día, por medio de pago, ganancia. El dueño puede anular (devuelve stock). |
| Compras | Dueño | Carga de compras con costo nuevo: compara con el costo anterior, muestra la variación y sugiere el precio de venta según el margen objetivo. |
| Comparador | Dueño | Subir listas de proveedores (Excel, CSV o texto pegado), vincularlas a los productos y ver quién está más barato. |
| Resumen | Dueño | Ventas de hoy/mes, ganancia, stock valorizado, medios de pago, ventas por vendedor/a y más vendidos. |
| Envíos | Todos | Pedidos para entregar y su estado. |
| Ajustes | Dueño | Usuarios y PIN, margen objetivo, redondeo, medios de pago, clave de sincronización con Sheets. |

## Estructura

```
app/               App React (Vite + Tailwind), instalable en el celular (PWA)
supabase/          Migraciones SQL: tablas, permisos (RLS) y funciones de negocio
google-sheets/     Script de Apps Script para sincronizar la planilla
scripts/           Scripts usados para importar la planilla original
```

## Seguridad

- Cada persona entra eligiendo su nombre y su PIN.
- Los empleados no ven costos, compras ni proveedores (lo controla la base de datos, no sólo la app).
- Las ventas sólo se crean con la función `registrar_venta`, que descuenta stock en la misma operación.
- La planilla se sincroniza con una clave propia (`SYNC_TOKEN`), que se puede regenerar desde Ajustes.

## Publicación

Cada cambio en `app/` que se sube a `main` se publica solo con GitHub Actions en GitHub Pages
(Settings → Pages → Source: **GitHub Actions**).

## Desarrollo

```bash
cd app
npm install
npm run dev
```
