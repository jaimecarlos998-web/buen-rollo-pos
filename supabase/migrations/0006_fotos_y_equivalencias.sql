-- Fotos de comprobantes + tabla de equivalencias proveedor → producto propio

alter table public.compras add column if not exists fotos text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 8 * 1024 * 1024, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy comprobantes_dueno_leer on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and (select public.es_dueno()));
create policy comprobantes_dueno_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and (select public.es_dueno()));

-- Cómo nombra/codifica cada proveedor a cada producto propio.
-- Un solo inventario (nombres cortos de uso diario) + esta tabla para reconocer facturas.
create table public.equivalencias (
  id bigint generated always as identity primary key,
  proveedor_id bigint not null references public.proveedores(id) on delete cascade,
  codigo_proveedor text,
  descripcion_proveedor text not null,
  producto_id bigint not null references public.productos(id) on delete cascade,
  unidades_por_bulto numeric(10,2) not null default 1 check (unidades_por_bulto > 0),
  actualizado_en timestamptz not null default now()
);
create unique index equivalencias_codigo on public.equivalencias (proveedor_id, codigo_proveedor) where codigo_proveedor is not null;
create unique index equivalencias_desc on public.equivalencias (proveedor_id, upper(descripcion_proveedor)) where codigo_proveedor is null;
create index on public.equivalencias (producto_id);
alter table public.equivalencias enable row level security;
create policy equivalencias_dueno on public.equivalencias for all to authenticated
  using ((select public.es_dueno())) with check ((select public.es_dueno()));

-- Guarda/actualiza una equivalencia
create or replace function public._guardar_equivalencia(p_proveedor_id bigint, p_codigo text, p_desc text, p_producto bigint, p_upb numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_proveedor_id is null or p_producto is null or coalesce(nullif(trim(p_desc), ''), nullif(trim(p_codigo), '')) is null then return; end if;
  if nullif(trim(p_codigo), '') is not null then
    insert into public.equivalencias (proveedor_id, codigo_proveedor, descripcion_proveedor, producto_id, unidades_por_bulto)
    values (p_proveedor_id, trim(p_codigo), coalesce(nullif(trim(p_desc), ''), trim(p_codigo)), p_producto, coalesce(p_upb, 1))
    on conflict (proveedor_id, codigo_proveedor) where codigo_proveedor is not null
    do update set descripcion_proveedor = excluded.descripcion_proveedor, producto_id = excluded.producto_id,
                  unidades_por_bulto = excluded.unidades_por_bulto, actualizado_en = now();
  else
    insert into public.equivalencias (proveedor_id, codigo_proveedor, descripcion_proveedor, producto_id, unidades_por_bulto)
    values (p_proveedor_id, null, trim(p_desc), p_producto, coalesce(p_upb, 1))
    on conflict (proveedor_id, upper(descripcion_proveedor)) where codigo_proveedor is null
    do update set producto_id = excluded.producto_id, unidades_por_bulto = excluded.unidades_por_bulto, actualizado_en = now();
  end if;
end; $$;
revoke execute on function public._guardar_equivalencia(bigint,text,text,bigint,numeric) from anon, authenticated, public;

-- Carga de compra completa (reemplaza a registrar_compra en la app).
-- Ítems: { producto_id | null, nombre, cantidad (en unidades), costo (por unidad), precio_nuevo,
--          codigo_proveedor, descripcion_proveedor, unidades_por_bulto }
-- Además de sumar stock y actualizar costos: aprende la equivalencia y guarda el precio
-- en la lista del proveedor (para el comparador).
create or replace function public.cargar_compra(
  p_proveedor text, p_items jsonb, p_nro_comprobante text default null,
  p_fecha date default null, p_notas text default null, p_fotos text[] default '{}'
) returns public.compras
language plpgsql security definer set search_path = '' as $$
declare c public.compras; it jsonb; v_prod bigint; i int := 0;
begin
  if not public.es_dueno() then raise exception 'Sólo el dueño carga compras'; end if;
  c := public._registrar_compra(p_proveedor, p_items, p_nro_comprobante, p_fecha, p_notas, 'app');
  update public.compras set fotos = coalesce(p_fotos, '{}') where id = c.id returning * into c;

  if c.proveedor_id is not null then
    for it in select * from jsonb_array_elements(p_items) loop
      i := i + 1;
      -- producto final de este renglón (puede ser uno recién creado)
      select ci.producto_id into v_prod from public.compra_items ci
        where ci.compra_id = c.id order by ci.id offset i - 1 limit 1;
      if nullif(it->>'descripcion_proveedor', '') is not null or nullif(it->>'codigo_proveedor', '') is not null then
        perform public._guardar_equivalencia(c.proveedor_id, it->>'codigo_proveedor', it->>'descripcion_proveedor',
                                             v_prod, nullif(it->>'unidades_por_bulto', '')::numeric);
      end if;
      insert into public.precios_proveedor (proveedor_id, producto_id, codigo_proveedor, descripcion, precio, fecha_lista)
      values (c.proveedor_id, v_prod, nullif(trim(it->>'codigo_proveedor'), ''),
              coalesce(nullif(trim(it->>'descripcion_proveedor'), ''), it->>'nombre', 'Producto'),
              (it->>'costo')::numeric, c.fecha);
    end loop;
  end if;
  return c;
end; $$;
revoke execute on function public.cargar_compra(text,jsonb,text,date,text,text[]) from anon, public;
grant execute on function public.cargar_compra(text,jsonb,text,date,text,text[]) to authenticated;

-- Equivalencias para la planilla (sólo lectura en Sheets)
create or replace function public.sync_equivalencias(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public._sync_ok(p_token);
  return (select coalesce(jsonb_agg(jsonb_build_array(pr.nombre, e.codigo_proveedor, e.descripcion_proveedor,
            p.sku, p.nombre, e.unidades_por_bulto) order by pr.nombre, e.descripcion_proveedor), '[]')
          from public.equivalencias e join public.proveedores pr on pr.id = e.proveedor_id
          join public.productos p on p.id = e.producto_id);
end; $$;
revoke execute on function public.sync_equivalencias(text) from authenticated, public;
grant execute on function public.sync_equivalencias(text) to anon;
