-- Borrar productos (desde la app o borrando la fila en Google Sheets).
-- Si el producto nunca se vendió ni se compró, se borra del todo.
-- Si tiene historial, queda archivado: no aparece más en la app ni en la planilla,
-- pero las ventas y compras viejas lo siguen mostrando.

alter table public.productos add column if not exists eliminado boolean not null default false;

create or replace function public._eliminar_producto(p_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.venta_items where producto_id = p_id)
     or exists (select 1 from public.compra_items where producto_id = p_id) then
    update public.productos set activo = false, eliminado = true where id = p_id;
    return 'archivado';
  end if;
  delete from public.productos where id = p_id;
  return 'borrado';
end; $$;
revoke execute on function public._eliminar_producto(bigint) from anon, authenticated, public;

create or replace function public.eliminar_producto(p_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_dueno() then raise exception 'Sólo el dueño puede borrar productos'; end if;
  return public._eliminar_producto(p_id);
end; $$;
revoke execute on function public.eliminar_producto(bigint) from anon, public;
grant execute on function public.eliminar_producto(bigint) to authenticated;

-- Filas borradas en la planilla. Con freno: si llegan demasiadas juntas, no borra nada.
create or replace function public.sync_eliminar(p_token text, p_skus text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_sku text; v_id bigint; n_borr int := 0; n_arch int := 0; r text; v_total int;
begin
  perform public._sync_ok(p_token);
  select count(*) into v_total from public.productos where not eliminado;
  if coalesce(array_length(p_skus, 1), 0) > greatest(10, v_total / 5) then
    raise exception 'Se borraron % productos de golpe en la planilla; por seguridad no se borró ninguno. Para borrar muchos, escribí "Borrar" en la columna Activo.', array_length(p_skus, 1);
  end if;
  foreach v_sku in array coalesce(p_skus, '{}') loop
    select id into v_id from public.productos where sku = upper(trim(v_sku)) and not eliminado;
    continue when v_id is null;
    r := public._eliminar_producto(v_id);
    if r = 'borrado' then n_borr := n_borr + 1; else n_arch := n_arch + 1; end if;
  end loop;
  return jsonb_build_object('borrados', n_borr, 'archivados', n_arch);
end; $$;
revoke execute on function public.sync_eliminar(text, text[]) from authenticated, public;
grant execute on function public.sync_eliminar(text, text[]) to anon;

-- Cambios de productos desde la planilla: "Borrar" en Activo elimina; si un SKU archivado vuelve, se reactiva.
create or replace function public.sync_productos(p_token text, p_filas jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare f jsonb; v_sku text; v_id bigint; n_upd int := 0; n_ins int := 0; n_del int := 0; nuevos jsonb := '[]';
begin
  perform public._sync_ok(p_token);
  perform set_config('app.motivo', 'Google Sheets', true);
  for f in select * from jsonb_array_elements(p_filas) loop
    v_sku := nullif(upper(trim(f->>'sku')), '');
    select id into v_id from public.productos where sku = v_sku;
    if upper(coalesce(f->>'activo', '')) like 'BORR%' then
      if v_id is not null then perform public._eliminar_producto(v_id); n_del := n_del + 1; end if;
      continue;
    end if;
    if nullif(trim(f->>'nombre'), '') is null then continue; end if;
    if v_id is not null then
      update public.productos set
        nombre = upper(trim(f->>'nombre')),
        codigo_barras = nullif(trim(f->>'codigo_barras'), ''),
        costo = nullif(f->>'costo', '')::numeric,
        precio = coalesce(nullif(f->>'precio', '')::numeric, precio),
        stock = stock + coalesce(nullif(f->>'stock', '')::numeric - nullif(f->>'stock_original', '')::numeric, 0),
        stock_minimo = coalesce(nullif(f->>'stock_minimo', '')::numeric, stock_minimo),
        activo = coalesce(upper(left(f->>'activo', 1)) <> 'N', true),
        eliminado = false
      where id = v_id;
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
  return jsonb_build_object('actualizados', n_upd, 'creados', n_ins, 'borrados', n_del, 'nuevos', nuevos);
end; $$;
revoke execute on function public.sync_productos(text, jsonb) from authenticated, public;
grant execute on function public.sync_productos(text, jsonb) to anon;

-- La planilla y los listados no muestran productos eliminados
do $$
declare def text;
begin
  def := pg_get_functiondef('public.sync_exportar(text)'::regprocedure);
  def := replace(def, 'from public.productos p),', 'from public.productos p where not p.eliminado),');
  execute def;
end $$;

create or replace function public.catalogo()
returns table (id bigint, sku text, nombre text, codigo_barras text,
               precio numeric, stock numeric, stock_minimo numeric)
language sql stable security definer set search_path = '' as $$
  select id, sku, nombre, codigo_barras, precio, stock, stock_minimo
  from public.productos
  where activo and not eliminado and public.es_usuario_activo()
  order by nombre;
$$;
