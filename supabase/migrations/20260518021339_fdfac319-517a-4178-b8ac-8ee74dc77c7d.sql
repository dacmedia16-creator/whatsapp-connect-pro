
CREATE TABLE public.contact_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE TABLE public.contact_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.contact_lists(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (list_id, contact_id)
);

CREATE INDEX idx_contact_list_items_list ON public.contact_list_items(list_id);
CREATE INDEX idx_contact_list_items_contact ON public.contact_list_items(contact_id);

ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_lists_manage ON public.contact_lists
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY contact_lists_read ON public.contact_lists
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY contact_list_items_manage ON public.contact_list_items
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY contact_list_items_read ON public.contact_list_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE TRIGGER tg_contact_lists_updated
  BEFORE UPDATE ON public.contact_lists
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
