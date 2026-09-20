begin;
-- The caller can read connection status; only the verified server manages its lifecycle.
revoke insert,update,delete on public.bank_connections from authenticated,anon;
create or replace function public.begin_plaid_disconnect(p_user_id uuid,p_connection_id uuid) returns jsonb language plpgsql security definer set search_path=public,vault as $$
declare c public.bank_connections; token text;
begin
 select * into strict c from public.bank_connections where id=p_connection_id and user_id=p_user_id for update;
 if c.status='disconnected' then return jsonb_build_object('done',true);end if;
 if not exists(select 1 from public.plaid_private_tokens where user_id=p_user_id and plaid_item_id=c.plaid_item_id) then raise exception 'Connection unavailable';end if;
 select decrypted_secret into strict token from vault.decrypted_secrets where name='plaid_'||c.plaid_item_id;
 update public.bank_connections set status='disconnect_pending' where id=c.id and user_id=p_user_id;
 return jsonb_build_object('done',false,'access_token',token);
end $$;
create or replace function public.finish_plaid_disconnect(p_user_id uuid,p_connection_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 update public.bank_connections set status='disconnected' where id=p_connection_id and user_id=p_user_id and status in ('disconnect_pending','disconnected');
 if not found then raise exception 'Connection unavailable';end if;
end $$;
revoke all on function public.begin_plaid_disconnect(uuid,uuid),public.finish_plaid_disconnect(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_plaid_disconnect(uuid,uuid),public.finish_plaid_disconnect(uuid,uuid) to service_role;
commit;
