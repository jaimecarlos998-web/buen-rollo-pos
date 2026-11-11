-- Buen Rollo POS · esquema base
-- Roles: 'dueno' ve y edita todo; 'empleado' vende y consulta catálogo/stock.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ───────────── Perfiles ─────────────
create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null unique,
  rol text not null default 'empleado' check (rol in ('dueno','empleado')),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create or replace function public.es_dueno() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p
                 where p.id = (select auth.uid()) and p.rol = 'dueno' and p.activo);
$$;

create or replace function public.es_usuario_activo() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p
                 where p.id = (select auth.uid()) and p.activo);
$$;

-- ───────────── Config ─────────────
create table public.config (
  clave text primary key,
  valor jsonb not null
);
insert into public.config values
  ('margen_objetivo', '40'),      -- % sobre costo
  ('redondeo', '100'),            -- redondear precio sugerido a múltiplos de $100
  ('stock_minimo_default', '2'),
  ('metodos_pago', '["Efectivo","Transferencia","Mercado Pago","Débito","Crédito"]');

-- ───────────── Proveedores ─────────────
create table public.proveedores (
  id bigint generated always as identity primary key,
  nombre text not null unique,
  telefono text,
  notas text,
  creado_en timestamptz not null default now()
);

-- ───────────── Productos ─────────────
create table public.productos (
  id bigint generated always as identity primary key,
  sku text not null unique,
  nombre text not null,
  codigo_barras text unique,
  costo numeric(14,2),
  precio numeric(14,2) not null default 0,
  stock numeric(12,2) not null default 0,
  stock_minimo numeric(12,2) not null default 2,
  activo boolean not null default true,
  actualizado_en timestamptz not null default now()
);
create index productos_nombre_trgm on public.productos using gin (nombre extensions.gin_trgm_ops);

create or replace function public.tocar_actualizado() returns trigger
language plpgsql set search_path = '' as $$
begin new.actualizado_en := now(); return new; end; $$;
create trigger productos_actualizado before update on public.productos
  for each row execute function public.tocar_actualizado();

-- ───────────── Historial de precios ─────────────
create table public.historial_precios (
  id bigint generated always as identity primary key,
  producto_id bigint not null references public.productos(id) on delete cascade,
  costo_anterior numeric(14,2),
  costo_nuevo numeric(14,2),
  precio_anterior numeric(14,2),
  precio_nuevo numeric(14,2),
  motivo text,
  usuario_id uuid references public.perfiles(id),
  fecha timestamptz not null default now()
);
create index on public.historial_precios (producto_id, fecha desc);

create or replace function public.registrar_cambio_precio() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.costo is distinct from old.costo or new.precio is distinct from old.precio then
    insert into public.historial_precios(producto_id, costo_anterior, costo_nuevo,
      precio_anterior, precio_nuevo, motivo, usuario_id)
    values (new.id, old.costo, new.costo, old.precio, new.precio,
      coalesce(nullif(current_setting('app.motivo', true), ''), 'edición'), (select auth.uid()));
  end if;
  return new;
end; $$;
create trigger productos_historial after update on public.productos
  for each row execute function public.registrar_cambio_precio();

-- ───────────── Ventas ─────────────
create table public.ventas (
  id bigint generated always as identity primary key,
  nro text not null unique,
  client_uuid uuid unique,               -- idempotencia (ventas offline)
  fecha timestamptz not null default now(),
  vendedor_id uuid references public.perfiles(id),
  vendedor_nombre text,
  cliente text,
  metodo_pago text,
  total numeric(14,2) not null default 0,
  costo_total numeric(14,2),
  notas text,
  anulada boolean not null default false,
  origen text not null default 'app' check (origen in ('app','importado'))
);
create index on public.ventas (fecha desc);
create index on public.ventas (vendedor_id, fecha desc);

create table public.venta_items (
  id bigint generated always as identity primary key,
  venta_id bigint not null references public.ventas(id) on delete cascade,
  producto_id bigint references public.productos(id),
  sku text,
  nombre text not null,
  cantidad numeric(12,2) not null check (cantidad > 0),
  precio_unit numeric(14,2) not null,
  costo_unit numeric(14,2),
  subtotal numeric(14,2) not null
);
create index on public.venta_items (venta_id);
create index on public.venta_items (producto_id);

-- ───────────── Compras ─────────────
create table public.compras (
  id bigint generated always as identity primary key,
  nro_comprobante text,
  fecha date not null default current_date,
  proveedor_id bigint references public.proveedores(id),
  total numeric(14,2) not null default 0,
  notas text,
  creado_por uuid references public.perfiles(id),
  origen text not null default 'app' check (origen in ('app','importado','sheets')),
  creado_en timestamptz not null default now()
);
create index on public.compras (fecha desc);
create index on public.compras (proveedor_id);

create table public.compra_items (
  id bigint generated always as identity primary key,
  compra_id bigint not null references public.compras(id) on delete cascade,
  producto_id bigint references public.productos(id),
  sku text,
  nombre text not null,
  cantidad numeric(12,2) not null check (cantidad > 0),
  costo_unit numeric(14,2) not null,
  costo_anterior numeric(14,2),
  subtotal numeric(14,2) not null
);
create index on public.compra_items (compra_id);
create index on public.compra_items (producto_id);

-- ───────────── Listas de precios de proveedores (comparador) ─────────────
create table public.precios_proveedor (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references public.proveedores(id) on delete cascade,
  producto_id bigint references public.productos(id) on delete set null,
  codigo_proveedor text,
  descripcion text not null,
  precio numeric(14,2) not null,
  fecha_lista date not null default current_date,
  creado_en timestamptz not null default now()
);
create index on public.precios_proveedor (producto_id, fecha_lista desc);
create index on public.precios_proveedor (proveedor_id, fecha_lista desc);

-- ───────────── Envíos ─────────────
create table public.envios (
  id bigint generated always as identity primary key,
  fecha date not null default current_date,
  cliente text not null,
  telefono text,
  direccion text,
  detalle text,
  estado text not null default 'Pendiente'
    check (estado in ('Pendiente','Preparando','En camino','Entregado','Cancelado')),
  costo numeric(14,2),
  notas text,
  venta_id bigint references public.ventas(id) on delete set null,
  creado_en timestamptz not null default now()
);
create index on public.envios (venta_id);
create index on public.historial_precios (usuario_id);
create index on public.ventas (vendedor_id);
create index on public.compras (creado_por);

-- ───────────── RLS ─────────────
alter table public.perfiles enable row level security;
alter table public.config enable row level security;
alter table public.proveedores enable row level security;
alter table public.productos enable row level security;
alter table public.historial_precios enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_items enable row level security;
alter table public.compras enable row level security;
alter table public.compra_items enable row level security;
alter table public.precios_proveedor enable row level security;
alter table public.envios enable row level security;

create policy perfiles_leer on public.perfiles for select to authenticated
  using ((select public.es_usuario_activo()));
create policy perfiles_dueno on public.perfiles for update to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));

create policy config_leer on public.config for select to authenticated
  using ((select public.es_usuario_activo()));
create policy config_dueno_ins on public.config for insert to authenticated
  with check ((select public.es_dueno()));
create policy config_dueno_upd on public.config for update to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));

-- Productos: el dueño ve todo (incluye costo). Los empleados usan la función catalogo().
create policy productos_dueno on public.productos for all to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));

create policy proveedores_dueno on public.proveedores for all to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));
create policy historial_dueno on public.historial_precios for select to authenticated
  using ((select public.es_dueno()));
create policy compras_dueno on public.compras for all to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));
create policy compra_items_dueno on public.compra_items for all to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));
create policy precios_prov_dueno on public.precios_proveedor for all to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));

-- Ventas: el dueño ve todas; cada empleado ve las suyas. Se crean sólo vía registrar_venta().
create policy ventas_leer on public.ventas for select to authenticated
  using ((select public.es_dueno()) or vendedor_id = (select auth.uid()));
create policy venta_items_leer on public.venta_items for select to authenticated
  using (exists (select 1 from public.ventas v where v.id = venta_id
         and ((select public.es_dueno()) or v.vendedor_id = (select auth.uid()))));

-- Envíos: todo el equipo los gestiona.
create policy envios_equipo on public.envios for all to authenticated
  using ((select public.es_usuario_activo())) with check ((select public.es_usuario_activo()));
