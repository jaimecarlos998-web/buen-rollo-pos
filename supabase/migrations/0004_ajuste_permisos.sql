-- Las funciones auxiliares de permisos sólo las usan usuarios logueados
revoke execute on function public.es_dueno() from anon, public;
revoke execute on function public.es_usuario_activo() from anon, public;
grant execute on function public.es_dueno() to authenticated;
grant execute on function public.es_usuario_activo() to authenticated;
-- Funciones de triggers: no se llaman por la API
revoke execute on function public.registrar_cambio_precio() from anon, authenticated, public;
revoke execute on function public.tocar_actualizado() from anon, authenticated, public;
