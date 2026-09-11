CREATE OR REPLACE FUNCTION public.is_care_desk_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(auth.jwt() ->> 'email', '') IN ('tim@popotso.app', 'mother@popotso.app');
$$;

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  sender_email text NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'text',
  attachment_path text,
  attachment_url text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint,
  duration_ms integer,
  client_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_created_at_idx ON public.messages (created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read messages" ON public.messages
  FOR SELECT TO authenticated USING (public.is_care_desk_member());

CREATE POLICY "Members can send messages" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (public.is_care_desk_member() AND sender_id = auth.uid());

CREATE POLICY "Members can delete own messages" ON public.messages
  FOR DELETE TO authenticated USING (public.is_care_desk_member() AND sender_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

CREATE POLICY "Members can read attachments" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'chat-attachments' AND public.is_care_desk_member());

CREATE POLICY "Members can upload attachments" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'chat-attachments' AND public.is_care_desk_member());

CREATE POLICY "Members can delete attachments" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'chat-attachments' AND public.is_care_desk_member());