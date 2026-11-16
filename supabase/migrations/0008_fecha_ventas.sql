-- El dueño puede cargar ventas con fecha pasada y cambiar la fecha de ventas ya cargadas.
-- Las empleadas siguen usando la hora del momento (o hasta 7 días atrás si la venta quedó guardada sin señal).

do $$
declare def text;
begin
  def := pg_get_functiondef('public.registrar_venta(jsonb,text,text,text,uuid,timestamptz)'::regprocedure);
  def := replace(def,
    'case when p_fecha is not null and p_fecha <= now() and p_fecha > now() - interval ''7 days''',
    'case when p_fecha is not null and p_fecha <= now() + interval ''5 minutes'' and (v_dueno or p_fecha > now() - interval ''7 days'')');
  execute def;
end $$;

create or replace function public.cambiar_fecha_venta(p_venta_id bigint, p_fecha timestamptz)
returns public.ventas language plpgsql security definer set search_path = '' as $$
declare v public.ventas;
begin
  if not public.es_dueno() then raise exception 'Sólo el dueño puede cambiar la fecha de una venta'; end if;
  if p_fecha is null or p_fecha > now() + interval '5 minutes' then raise exception 'La fecha no puede ser futura'; end if;
  update public.ventas set fecha = p_fecha where id = p_venta_id returning * into v;
  if not found then raise exception 'Venta no encontrada'; end if;
  return v;
end; $$;
revoke execute on function public.cambiar_fecha_venta(bigint, timestamptz) from anon, public;
grant execute on function public.cambiar_fecha_venta(bigint, timestamptz) to authenticated;
