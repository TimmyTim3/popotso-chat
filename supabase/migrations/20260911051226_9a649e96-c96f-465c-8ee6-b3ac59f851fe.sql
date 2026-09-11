CREATE OR REPLACE FUNCTION public.is_care_desk_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(auth.jwt() ->> 'email', '') IN ('tim@popotso.app', 'mother@popotso.app');
$$;