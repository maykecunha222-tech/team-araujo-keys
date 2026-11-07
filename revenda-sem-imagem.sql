begin;

alter table public.zentrix_pix_receipts
  alter column image_hash drop not null,
  alter column mime drop not null;

do $$
declare
  existing_check name;
begin
  select conname into existing_check
  from pg_constraint
  where conrelid = 'public.zentrix_pix_receipts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) = 'CHECK (((status = ''review''::text) = (image IS NOT NULL)))';

  if existing_check is not null then
    execute format('alter table public.zentrix_pix_receipts drop constraint %I', existing_check);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.zentrix_pix_receipts'::regclass
      and conname = 'zentrix_pix_receipts_image_state'
  ) then
    alter table public.zentrix_pix_receipts
      add constraint zentrix_pix_receipts_image_state check (
        (image_hash is null) = (mime is null)
        and (image is not null) = (status = 'review' and image_hash is not null)
      );
  end if;
end;
$$;

commit;