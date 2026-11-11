-- Buen Rollo POS · sincronización con Google Sheets (Apps Script)
-- El script de la planilla se autentica con un token propio (no con la clave secreta de Supabase).

create table public.sync_secretos (
  id int primary key default 1 check (id = 1),
  token_hash text not null,
  ultima_sync timestamptz
);
alter table public.sync_secretos enable row level security;  -- sin políticas: nadie la lee por la API

create or replace function public._sync_ok(p_token text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ok boolean;
begin
  select token_hash = extensions.crypt(p_token, token_hash) into ok from public.sync_secretos where id = 1;
  if not coalesce(ok, false) then
    perform pg_sleep(1);  -- frena intentos por fuerza bruta
    raise exception 'Token de sincronización inválido';
  end if;
  update public.sync_secretos set ultima_sync = now() where id = 1;
  return true;
end; $$;
revoke execute on function public._sync_ok(text) from anon, authenticated, public;

-- Rotar el token (sólo dueño desde la app). Devuelve el token nuevo una única vez.
create or replace function public.sync_nuevo_token() returns text
language plpgsql security definer set search_path = '' as $$
declare t text := 'brsync_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.es_dueno() then raise exception 'No autorizado'; end if;
  insert into public.sync_secretos (id, token_hash) values (1, extensions.crypt(t, extensions.gen_salt('bf')))
    on conflict (id) do update set token_hash = excluded.token_hash;
  return t;
end; $$;
revoke execute on function public.sync_nuevo_token() from anon, public;
grant execute on function public.sync_nuevo_token() to authenticated;

-- Exporta todo lo que se muestra en la planilla
create or replace function public.sync_exportar(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public._sync_ok(p_token);
  return jsonb_build_object(
    'generado', now(),
    'productos', (select coalesce(jsonb_agg(jsonb_build_array(
        p.sku, p.nombre, p.codigo_barras, p.costo, p.precio, p.stock, p.stock_minimo,
        case when p.stock <= p.stock_minimo then '⚠️ Reponer' else 'OK' end,
        case when p.costo > 0 then round((p.precio - p.costo) / p.costo * 100, 1) end,
        case when p.activo then 'Sí' else 'No' end,
        to_char(p.actualizado_en at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI'))
        order by p.nombre), '[]') from public.productos p),
    'ventas', (select coalesce(jsonb_agg(jsonb_build_array(
        to_char(v.fecha at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD HH24:MI:SS'),
        v.nro, vi.sku, vi.nombre, vi.cantidad, vi.precio_unit, vi.subtotal, v.metodo_pago,
        v.cliente, v.vendedor_nombre, v.notas, case when v.anulada then 'ANULADA' else '' end)
        order by v.fecha desc, vi.id), '[]')
        from (select * from public.ventas order by fecha desc limit 20000) v
        join public.venta_items vi on vi.venta_id = v.id),
    'compras', (select coalesce(jsonb_agg(jsonb_build_array(
        c.id, to_char(c.fecha, 'YYYY-MM-DD'), pr.nombre, c.nro_comprobante, ci.sku, ci.nombre,
        ci.cantidad, ci.costo_unit, ci.subtotal, ci.costo_anterior,
        case when ci.costo_anterior > 0 then round((ci.costo_unit - ci.costo_anterior) / ci.costo_anterior * 100, 1) end,
        c.origen)
        order by c.fecha desc, c.id desc, ci.id), '[]')
        from public.compras c join public.compra_items ci on ci.compra_id = c.id
        left join public.proveedores pr on pr.id = c.proveedor_id),
    'precios', (select coalesce(jsonb_agg(jsonb_build_array(
        pp.id, pr.nombre, pp.codigo_proveedor, pp.descripcion, pp.precio, to_char(pp.fecha_lista, 'YYYY-MM-DD'),
        p.sku, p.nombre, p.costo,
        case when p.costo > 0 then round((pp.precio - p.costo) / p.costo * 100, 1) end)
        order by pr.nombre, pp.descripcion), '[]')
        from public.precios_proveedor pp join public.proveedores pr on pr.id = pp.proveedor_id
        left join public.productos p on p.id = pp.producto_id),
    'resumen', (select jsonb_build_object(
        'ventas_hoy', coalesce(sum(total) filter (where (fecha at time zone 'America/Argentina/Buenos_Aires')::date
                       = (now() at time zone 'America/Argentina/Buenos_Aires')::date), 0),
        'ventas_mes', coalesce(sum(total) filter (where date_trunc('month', fecha at time zone 'America/Argentina/Buenos_Aires')
                       = date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')), 0),
        'ganancia_mes', coalesce(sum(total - coalesce(costo_total, 0)) filter (where date_trunc('month', fecha at time zone 'America/Argentina/Buenos_Aires')
                       = date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')), 0))
        from public.ventas where not anulada)
  );
end; $$;
revoke execute on function public.sync_exportar(text) from authenticated, public;
grant execute on function public.sync_exportar(text) to anon;

-- Cambios de productos hechos en la planilla.
-- p_filas: [{sku, nombre, codigo_barras, costo, precio, stock, stock_original, stock_minimo, activo}]
-- El stock se ajusta por diferencia (stock - stock_original) para no pisar ventas hechas mientras tanto.
create or replace function public.sync_productos(p_token text, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f jsonb; v_sku text; n_upd int := 0; n_ins int := 0; nuevos jsonb := '[]';
begin
  perform public._sync_ok(p_token);
  perform set_config('app.motivo', 'Google Sheets', true);
  for f in select * from jsonb_array_elements(p_filas) loop
    v_sku := nullif(upper(trim(f->>'sku')), '');
    if nullif(trim(f->>'nombre'), '') is null then continue; end if;
    if v_sku is not null and exists (select 1 from public.productos where sku = v_sku) then
      update public.productos set
        nombre = upper(trim(f->>'nombre')),
        codigo_barras = nullif(trim(f->>'codigo_barras'), ''),
        costo = nullif(f->>'costo', '')::numeric,
        precio = coalesce(nullif(f->>'precio', '')::numeric, precio),
        stock = stock + coalesce(nullif(f->>'stock', '')::numeric - nullif(f->>'stock_original', '')::numeric, 0),
        stock_minimo = coalesce(nullif(f->>'stock_minimo', '')::numeric, stock_minimo),
        activo = coalesce(upper(left(f->>'activo', 1)) <> 'N', true)
      where sku = v_sku;
      n_upd := n_upd + 1;
    else
      insert into public.productos (sku, nombre, codigo_barras, costo, precio, stock, stock_minimo)
      values (coalesce(v_sku, public.nuevo_sku(f->>'nombre')), upper(trim(f->>'nombre')),
              nullif(trim(f->>'codigo_barras'), ''), nullif(f->>'costo', '')::numeric,
              coalesce(nullif(f->>'precio', '')::numeric, 0), coalesce(nullif(f->>'stock', '')::numeric, 0),
              coalesce(nullif(f->>'stock_minimo', '')::numeric, 2))
      returning jsonb_build_object('fila', f->'fila', 'sku', sku) into f;
      nuevos := nuevos || f; n_ins := n_ins + 1;
    end if;
  end loop;
  return jsonb_build_object('actualizados', n_upd, 'creados', n_ins, 'nuevos', nuevos);
end; $$;
revoke execute on function public.sync_productos(text, jsonb) from authenticated, public;
grant execute on function public.sync_productos(text, jsonb) to anon;

-- Compras cargadas en la planilla (filas sin ID). Se agrupan por fecha + proveedor + comprobante.
-- p_filas: [{fila, fecha, proveedor, nro, sku, producto, cantidad, costo, precio_nuevo}]
create or replace function public.sync_compras(p_token text, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; c public.compras; res jsonb := '[]';
begin
  perform public._sync_ok(p_token);
  for g in
    select coalesce(nullif(f->>'fecha', ''), to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')) fecha,
           coalesce(f->>'proveedor', '') proveedor, coalesce(f->>'nro', '') nro,
           jsonb_agg(jsonb_build_object('sku', f->>'sku', 'nombre', f->>'producto', 'cantidad', f->'cantidad',
                     'costo', f->'costo', 'precio_nuevo', f->'precio_nuevo')) items,
           jsonb_agg(f->'fila') filas
    from jsonb_array_elements(p_filas) f
    group by 1, 2, 3
  loop
    c := public._registrar_compra(g.proveedor, g.items, g.nro, g.fecha::date, 'Cargada en Google Sheets', 'sheets');
    res := res || jsonb_build_object('compra_id', c.id, 'filas', g.filas);
  end loop;
  return res;
end; $$;
revoke execute on function public.sync_compras(text, jsonb) from authenticated, public;
grant execute on function public.sync_compras(text, jsonb) to anon;

-- Listas de precios de proveedores pegadas en la planilla (filas sin ID).
-- p_filas: [{fila, proveedor, codigo, descripcion, precio, fecha, sku}]
create or replace function public.sync_precios(p_token text, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f jsonb; v_prov bigint; v_prod bigint; v_id bigint; res jsonb := '[]';
begin
  perform public._sync_ok(p_token);
  for f in select * from jsonb_array_elements(p_filas) loop
    if nullif(trim(f->>'proveedor'), '') is null or nullif(f->>'precio', '') is null then continue; end if;
    insert into public.proveedores (nombre) values (trim(f->>'proveedor'))
      on conflict (nombre) do update set nombre = excluded.nombre returning id into v_prov;
    select id into v_prod from public.productos
      where sku = nullif(upper(trim(f->>'sku')), '')
         or (nullif(trim(f->>'codigo'), '') is not null and codigo_barras = trim(f->>'codigo'))
         or nombre = upper(trim(f->>'descripcion'))
      limit 1;
    insert into public.precios_proveedor (proveedor_id, producto_id, codigo_proveedor, descripcion, precio, fecha_lista)
    values (v_prov, v_prod, nullif(trim(f->>'codigo'), ''), coalesce(nullif(trim(f->>'descripcion'), ''), f->>'sku'),
            (f->>'precio')::numeric,
            coalesce(nullif(f->>'fecha', '')::date, (now() at time zone 'America/Argentina/Buenos_Aires')::date))
    returning id into v_id;
    res := res || jsonb_build_object('fila', f->'fila', 'id', v_id);
  end loop;
  return res;
end; $$;
revoke execute on function public.sync_precios(text, jsonb) from authenticated, public;
grant execute on function public.sync_precios(text, jsonb) to anon;
