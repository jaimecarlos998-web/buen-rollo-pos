-- Buen Rollo POS · funciones de negocio

-- Lista de usuarios para la pantalla de ingreso (sólo nombres, sin datos sensibles)
create or replace function public.usuarios_login()
returns table (nombre text, email text)
language sql stable security definer set search_path = '' as $$
  select p.nombre, u.email::text
  from public.perfiles p join auth.users u on u.id = p.id
  where p.activo order by p.rol desc, p.nombre;
$$;
grant execute on function public.usuarios_login() to anon, authenticated;

-- Catálogo para vender (sin costo)
create or replace function public.catalogo()
returns table (id bigint, sku text, nombre text, codigo_barras text,
               precio numeric, stock numeric, stock_minimo numeric)
language sql stable security definer set search_path = '' as $$
  select id, sku, nombre, codigo_barras, precio, stock, stock_minimo
  from public.productos
  where activo and public.es_usuario_activo()
  order by nombre;
$$;
revoke execute on function public.catalogo() from anon, public;
grant execute on function public.catalogo() to authenticated;

-- Registrar una venta (descuenta stock). Idempotente por client_uuid.
-- p_items: [{ "producto_id": 1, "cantidad": 2, "precio": 1500 }]
create or replace function public.registrar_venta(
  p_items jsonb,
  p_metodo_pago text,
  p_cliente text default null,
  p_notas text default null,
  p_client_uuid uuid default null,
  p_fecha timestamptz default null
) returns public.ventas
language plpgsql security definer set search_path = '' as $$
declare
  v public.ventas;
  it jsonb;
  prod public.productos;
  v_precio numeric;
  v_cant numeric;
  v_total numeric := 0;
  v_costo numeric := 0;
  v_dueno boolean := public.es_dueno();
  v_nombre text;
begin
  if not public.es_usuario_activo() then raise exception 'No autorizado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos';
  end if;

  if p_client_uuid is not null then
    select * into v from public.ventas where client_uuid = p_client_uuid;
    if found then return v; end if;
  end if;

  select nombre into v_nombre from public.perfiles where id = auth.uid();

  insert into public.ventas (nro, client_uuid, fecha, vendedor_id, vendedor_nombre,
                             cliente, metodo_pago, notas)
  values ('P-' || to_char(coalesce(p_fecha, now()) at time zone 'America/Argentina/Buenos_Aires',
                          'YYMMDD-HH24MISS') || '-' || substr(md5(random()::text), 1, 3),
          p_client_uuid,
          -- la fecha del celular sólo se acepta si no es futura ni muy vieja (ventas offline)
          case when p_fecha is not null and p_fecha <= now() and p_fecha > now() - interval '7 days'
               then p_fecha else now() end,
          auth.uid(), v_nombre, nullif(trim(p_cliente), ''), p_metodo_pago, nullif(trim(p_notas), ''))
  returning * into v;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into prod from public.productos where id = (it->>'producto_id')::bigint for update;
    if not found then raise exception 'Producto % no existe', it->>'producto_id'; end if;
    v_cant := (it->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida para %', prod.nombre; end if;
    -- sólo el dueño puede cambiar el precio de lista al vender
    v_precio := case when v_dueno and it ? 'precio' then (it->>'precio')::numeric else prod.precio end;

    insert into public.venta_items (venta_id, producto_id, sku, nombre, cantidad, precio_unit, costo_unit, subtotal)
    values (v.id, prod.id, prod.sku, prod.nombre, v_cant, v_precio, prod.costo, v_cant * v_precio);

    update public.productos set stock = stock - v_cant where id = prod.id;
    v_total := v_total + v_cant * v_precio;
    v_costo := v_costo + v_cant * coalesce(prod.costo, 0);
  end loop;

  update public.ventas set total = v_total, costo_total = v_costo where id = v.id returning * into v;
  return v;
end; $$;
revoke execute on function public.registrar_venta(jsonb,text,text,text,uuid,timestamptz) from anon, public;
grant execute on function public.registrar_venta(jsonb,text,text,text,uuid,timestamptz) to authenticated;

-- Anular una venta (devuelve stock). Sólo dueño.
create or replace function public.anular_venta(p_venta_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_dueno() then raise exception 'Sólo el dueño puede anular ventas'; end if;
  if exists (select 1 from public.ventas where id = p_venta_id and not anulada) then
    update public.productos p set stock = p.stock + vi.cantidad
      from public.venta_items vi where vi.venta_id = p_venta_id and vi.producto_id = p.id;
    update public.ventas set anulada = true where id = p_venta_id;
  end if;
end; $$;
revoke execute on function public.anular_venta(bigint) from anon, public;
grant execute on function public.anular_venta(bigint) to authenticated;

-- Registrar una compra. Suma stock, actualiza costo y opcionalmente precio.
-- p_items: [{ "producto_id": 1 | null, "sku": "...", "nombre": "...", "cantidad": 3,
--             "costo": 1200, "precio_nuevo": 1800 | null }]
create or replace function public._registrar_compra(
  p_proveedor text,
  p_items jsonb,
  p_nro_comprobante text default null,
  p_fecha date default null,
  p_notas text default null,
  p_origen text default 'app'
) returns public.compras
language plpgsql security definer set search_path = '' as $$
declare
  c public.compras;
  it jsonb;
  prod public.productos;
  v_prov bigint;
  v_cant numeric; v_costo numeric; v_precio numeric;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La compra no tiene productos'; end if;

  if nullif(trim(p_proveedor), '') is not null then
    insert into public.proveedores (nombre) values (trim(p_proveedor))
      on conflict (nombre) do update set nombre = excluded.nombre returning id into v_prov;
  end if;

  insert into public.compras (nro_comprobante, fecha, proveedor_id, notas, creado_por, origen)
  values (nullif(trim(p_nro_comprobante), ''), coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date), v_prov,
          nullif(trim(p_notas), ''), auth.uid(), p_origen)
  returning * into c;

  perform set_config('app.motivo', 'compra #' || c.id, true);

  for it in select * from jsonb_array_elements(p_items) loop
    v_cant := (it->>'cantidad')::numeric;
    v_costo := (it->>'costo')::numeric;
    v_precio := nullif(it->>'precio_nuevo', '')::numeric;
    if v_cant is null or v_cant <= 0 or v_costo is null or v_costo < 0 then
      raise exception 'Cantidad o costo inválido en %', coalesce(it->>'nombre', it->>'sku');
    end if;

    prod := null;
    if it->>'producto_id' is not null then
      select * into prod from public.productos where id = (it->>'producto_id')::bigint for update;
    elsif nullif(it->>'sku', '') is not null then
      select * into prod from public.productos where sku = upper(trim(it->>'sku')) for update;
    end if;

    if prod.id is null then
      if nullif(trim(it->>'nombre'), '') is null then raise exception 'Producto nuevo sin nombre'; end if;
      insert into public.productos (sku, nombre, costo, precio, stock)
      values (coalesce(nullif(upper(trim(it->>'sku')), ''), public.nuevo_sku(it->>'nombre')),
              upper(trim(it->>'nombre')), v_costo, coalesce(v_precio, 0), 0)
      returning * into prod;
    end if;

    insert into public.compra_items (compra_id, producto_id, sku, nombre, cantidad, costo_unit, costo_anterior, subtotal)
    values (c.id, prod.id, prod.sku, prod.nombre, v_cant, v_costo, prod.costo, v_cant * v_costo);

    update public.productos set
      stock = stock + v_cant,
      costo = v_costo,
      precio = coalesce(v_precio, precio)
    where id = prod.id;

    v_total := v_total + v_cant * v_costo;
  end loop;

  update public.compras set total = v_total where id = c.id returning * into c;
  return c;
end; $$;
revoke execute on function public._registrar_compra(text,jsonb,text,date,text,text) from anon, authenticated, public;

create or replace function public.registrar_compra(
  p_proveedor text, p_items jsonb, p_nro_comprobante text default null,
  p_fecha date default null, p_notas text default null
) returns public.compras
language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_dueno() then raise exception 'Sólo el dueño carga compras'; end if;
  return public._registrar_compra(p_proveedor, p_items, p_nro_comprobante, p_fecha, p_notas, 'app');
end; $$;
revoke execute on function public.registrar_compra(text,jsonb,text,date,text) from anon, public;
grant execute on function public.registrar_compra(text,jsonb,text,date,text) to authenticated;

-- Genera SKU tipo "ALA-0277" a partir del nombre
create or replace function public.nuevo_sku(p_nombre text) returns text
language plpgsql security definer set search_path = '' as $$
declare pref text; n int;
begin
  pref := upper(substr(regexp_replace(extensions.unaccent(coalesce(p_nombre,'PRD')), '[^A-Za-z]', '', 'g') || 'XXX', 1, 3));
  select coalesce(max(nullif(regexp_replace(sku, '^.*-', ''), '')::int), 0) + 1 into n
    from public.productos where sku ~ '^[A-Z]{3}-[0-9]+$';
  return pref || '-' || lpad(n::text, 4, '0');
end; $$;
revoke execute on function public.nuevo_sku(text) from anon, public;
grant execute on function public.nuevo_sku(text) to authenticated;

-- Comparador: último precio de cada proveedor por producto
create or replace function public.comparar_precios()
returns table (producto_id bigint, sku text, nombre text, costo_actual numeric, precio_venta numeric,
               proveedor text, precio_proveedor numeric, fecha_lista date, es_mas_barato boolean,
               dif_vs_costo_pct numeric)
language sql stable security definer set search_path = '' as $$
  with ult as (
    select distinct on (pp.producto_id, pp.proveedor_id)
           pp.producto_id, pp.proveedor_id, pp.precio, pp.fecha_lista
    from public.precios_proveedor pp
    where pp.producto_id is not null
    order by pp.producto_id, pp.proveedor_id, pp.fecha_lista desc, pp.id desc
  ), mins as (select producto_id, min(precio) m from ult group by producto_id)
  select p.id, p.sku, p.nombre, p.costo, p.precio, pr.nombre, u.precio, u.fecha_lista,
         u.precio = mi.m,
         case when p.costo > 0 then round((u.precio - p.costo) / p.costo * 100, 1) end
  from ult u
  join public.productos p on p.id = u.producto_id
  join public.proveedores pr on pr.id = u.proveedor_id
  join mins mi on mi.producto_id = u.producto_id
  where public.es_dueno()
  order by p.nombre, u.precio;
$$;
revoke execute on function public.comparar_precios() from anon, public;
grant execute on function public.comparar_precios() to authenticated;

-- Búsqueda difusa de productos para emparejar listas de proveedores
create or replace function public.buscar_similares(p_texto text, p_limite int default 3)
returns table (id bigint, sku text, nombre text, similitud real)
language sql stable security definer set search_path = '' as $$
  select id, sku, nombre, extensions.similarity(nombre, upper(p_texto))
  from public.productos
  where public.es_dueno()
  order by extensions.similarity(nombre, upper(p_texto)) desc
  limit p_limite;
$$;
revoke execute on function public.buscar_similares(text,int) from anon, public;
grant execute on function public.buscar_similares(text,int) to authenticated;

-- Resumen del negocio (sólo dueño). Fechas en hora de Argentina.
create or replace function public.resumen()
returns jsonb language sql stable security definer set search_path = '' as $$
  with hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date d),
  v as (select *, (fecha at time zone 'America/Argentina/Buenos_Aires')::date dia
        from public.ventas where not anulada)
  select case when not public.es_dueno() then null else jsonb_build_object(
    'productos', (select count(*) from public.productos where activo),
    'a_reponer', (select count(*) from public.productos where activo and stock <= stock_minimo),
    'valor_stock_costo', (select coalesce(sum(greatest(stock,0) * coalesce(costo,0)),0) from public.productos where activo),
    'valor_stock_venta', (select coalesce(sum(greatest(stock,0) * precio),0) from public.productos where activo),
    'ventas_hoy', (select coalesce(sum(total),0) from v, hoy where dia = hoy.d),
    'pedidos_hoy', (select count(*) from v, hoy where dia = hoy.d),
    'ventas_mes', (select coalesce(sum(total),0) from v, hoy where date_trunc('month', dia) = date_trunc('month', hoy.d)),
    'ganancia_mes', (select coalesce(sum(total - coalesce(costo_total,0)),0) from v, hoy
                     where date_trunc('month', dia) = date_trunc('month', hoy.d)),
    'compras_mes', (select coalesce(sum(total),0) from public.compras, hoy
                    where date_trunc('month', fecha) = date_trunc('month', hoy.d)),
    'envios_pendientes', (select count(*) from public.envios where estado in ('Pendiente','Preparando','En camino')),
    'por_metodo', (select coalesce(jsonb_object_agg(coalesce(metodo_pago,'Sin dato'), t), '{}') from
                    (select metodo_pago, sum(total) t from v, hoy
                     where date_trunc('month', dia) = date_trunc('month', hoy.d) group by 1) x),
    'por_vendedor', (select coalesce(jsonb_object_agg(coalesce(vendedor_nombre,'Sin dato'), t), '{}') from
                    (select vendedor_nombre, sum(total) t from v, hoy
                     where date_trunc('month', dia) = date_trunc('month', hoy.d) group by 1) x),
    'ultimos_30_dias', (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'total', t) order by d), '[]') from
                    (select dia d, sum(total) t from v, hoy where dia > hoy.d - 30 group by dia) x),
    'top_productos', (select coalesce(jsonb_agg(x order by x.unidades desc), '[]') from
                    (select vi.nombre, sum(vi.cantidad) unidades, sum(vi.subtotal) total
                     from public.venta_items vi join v on v.id = vi.venta_id, hoy
                     where v.dia > hoy.d - 30 group by vi.nombre order by 2 desc limit 10) x)
  ) end;
$$;
revoke execute on function public.resumen() from anon, public;
grant execute on function public.resumen() to authenticated;

-- Cambiar PIN de un usuario (dueño) o el propio
create or replace function public.cambiar_pin(p_usuario uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.es_dueno() or p_usuario = auth.uid()) then raise exception 'No autorizado'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'El PIN debe tener 4 a 6 números'; end if;
  update auth.users set encrypted_password = extensions.crypt('BR-pin-' || p_pin, extensions.gen_salt('bf'))
  where id = p_usuario;
end; $$;
revoke execute on function public.cambiar_pin(uuid,text) from anon, public;
grant execute on function public.cambiar_pin(uuid,text) to authenticated;
