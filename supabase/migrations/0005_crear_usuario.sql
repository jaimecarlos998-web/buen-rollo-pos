-- Alta de usuarios desde la app (sólo dueño). Ingresan eligiendo su nombre + PIN.
create or replace function public.crear_usuario(p_nombre text, p_pin text, p_rol text default 'empleado')
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := gen_random_uuid(); v_slug text; v_email text;
begin
  if not public.es_dueno() then raise exception 'No autorizado'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'El PIN debe tener 4 a 6 números'; end if;
  if p_rol not in ('dueno','empleado') then raise exception 'Rol inválido'; end if;
  if nullif(trim(p_nombre), '') is null then raise exception 'Falta el nombre'; end if;
  v_slug := lower(regexp_replace(extensions.unaccent(trim(p_nombre)), '[^A-Za-z0-9]+', '.', 'g'));
  v_email := v_slug || '@buenrollo.app';
  if exists (select 1 from auth.users where email = v_email) then
    v_email := v_slug || '.' || substr(md5(random()::text), 1, 4) || '@buenrollo.app';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
    phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt('BR-pin-' || p_pin, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', trim(p_nombre)), now(), now(),
    '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
    jsonb_build_object('sub', uid::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  insert into public.perfiles (id, nombre, rol) values (uid, trim(p_nombre), p_rol);
  return uid;
end; $$;
revoke execute on function public.crear_usuario(text, text, text) from anon, public;
grant execute on function public.crear_usuario(text, text, text) to authenticated;

-- El dueño no puede quitarse a sí mismo el rol ni desactivarse (para no quedar afuera)
create or replace function public.proteger_dueno() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.id = auth.uid() and (new.rol <> 'dueno' or not new.activo) then
    raise exception 'No podés quitarte el rol de dueño ni desactivarte';
  end if;
  return new;
end; $$;
revoke execute on function public.proteger_dueno() from anon, authenticated, public;
create trigger perfiles_proteger before update on public.perfiles
  for each row execute function public.proteger_dueno();
