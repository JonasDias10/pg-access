create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name varchar(255),
  email text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

grant select, insert, update, delete on public.profiles to authenticated;

create schema if not exists private;

create or replace function private.handle_new_profile() returns trigger as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer set search_path = 'public';

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_profile();

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(user_id) on delete cascade,
  title varchar(255) not null,
  content text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

grant select, insert, update, delete on public.posts to authenticated;
