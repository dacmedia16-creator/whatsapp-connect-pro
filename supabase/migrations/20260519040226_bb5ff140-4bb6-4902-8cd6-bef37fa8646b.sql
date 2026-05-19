with ranked as (
  select id, contact_id, channel_id, unread_count, last_message_at, created_at,
         row_number() over (partition by contact_id order by created_at asc) as rn,
         first_value(id) over (partition by contact_id order by created_at asc) as canonical_id
  from public.conversations
),
dupes as (
  select id, canonical_id, contact_id, channel_id, unread_count, last_message_at
  from ranked
  where rn > 1
),
agg as (
  select canonical_id,
         sum(unread_count)::int as extra_unread,
         max(last_message_at) as max_lma,
         (array_remove(array_agg(channel_id order by last_message_at desc), null))[1] as any_channel
  from dupes
  group by canonical_id
),
moved as (
  update public.messages m
     set conversation_id = d.canonical_id
    from dupes d
   where m.conversation_id = d.id
  returning 1
),
updated as (
  update public.conversations c
     set unread_count = c.unread_count + a.extra_unread,
         last_message_at = greatest(c.last_message_at, a.max_lma),
         channel_id = coalesce(c.channel_id, a.any_channel)
    from agg a
   where c.id = a.canonical_id
  returning 1
)
delete from public.conversations
 where id in (select id from dupes);