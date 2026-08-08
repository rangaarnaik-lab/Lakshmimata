-- Star rating required (1–5) + public aggregate stats for home page.
update public.user_feedback set rating = 5 where rating is null;

alter table public.user_feedback
  alter column rating set default 5;

alter table public.user_feedback
  drop constraint if exists user_feedback_rating_check;

alter table public.user_feedback
  add constraint user_feedback_rating_check check (rating >= 1 and rating <= 5);

alter table public.user_feedback
  alter column rating set not null;

create or replace function public.get_user_feedback_rating_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    json_build_object(
      'average', round(avg(rating)::numeric, 1),
      'total', count(*)::int,
      'distribution', json_build_object(
        '5', count(*) filter (where rating = 5)::int,
        '4', count(*) filter (where rating = 4)::int,
        '3', count(*) filter (where rating = 3)::int,
        '2', count(*) filter (where rating = 2)::int,
        '1', count(*) filter (where rating = 1)::int
      )
    ),
    json_build_object(
      'average', 0,
      'total', 0,
      'distribution', json_build_object('5',0,'4',0,'3',0,'2',0,'1',0)
    )
  )
  from public.user_feedback
  where is_public = true;
$$;

grant execute on function public.get_user_feedback_rating_stats() to anon, authenticated;
