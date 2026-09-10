-- Supabase deployment companion to 0000_anything_anywhere_shared_backend.sql.
-- API servers with an elevated DB role should still enforce the same ownership
-- checks in application code; RLS is defense in depth for direct clients.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_photo_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotion_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_conversation_entries ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS profile_role LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.current_driver_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT id FROM public.drivers WHERE profile_id = public.current_profile_id() LIMIT 1 $$;

DROP POLICY IF EXISTS "profiles_are_self_or_staff" ON profiles;
DROP POLICY IF EXISTS "customers_manage_own_addresses" ON customer_addresses;
DROP POLICY IF EXISTS "customers_manage_own_contacts" ON contacts;
DROP POLICY IF EXISTS "drivers_read_own_profile" ON drivers;
DROP POLICY IF EXISTS "drivers_read_own_documents" ON driver_documents;
DROP POLICY IF EXISTS "admins_read_driver_applications" ON driver_applications;
DROP POLICY IF EXISTS "admins_read_driver_incidents" ON driver_incidents;
DROP POLICY IF EXISTS "drivers_read_own_incidents" ON driver_incidents;
DROP POLICY IF EXISTS "customers_read_own_deliveries" ON deliveries;
DROP POLICY IF EXISTS "drivers_read_assigned_deliveries" ON deliveries;
DROP POLICY IF EXISTS "admins_read_deliveries" ON deliveries;
DROP POLICY IF EXISTS "staff_read_deliveries" ON deliveries;
DROP POLICY IF EXISTS "customers_read_own_history" ON delivery_status_history;
DROP POLICY IF EXISTS "drivers_read_assigned_history" ON delivery_status_history;
DROP POLICY IF EXISTS "drivers_insert_own_locations" ON driver_locations;
DROP POLICY IF EXISTS "delivery_participants_read_photos" ON delivery_photos;
DROP POLICY IF EXISTS "delivery_participants_attach_photos" ON delivery_photos;
DROP POLICY IF EXISTS "delivery_participants_create_photo_uploads" ON delivery_photo_uploads;
DROP POLICY IF EXISTS "customers_read_own_quotes" ON delivery_quotes;
DROP POLICY IF EXISTS "customers_read_own_payments" ON payments;
DROP POLICY IF EXISTS "admins_read_payments" ON payments;
DROP POLICY IF EXISTS "customers_create_own_tickets" ON support_tickets;
DROP POLICY IF EXISTS "customers_read_own_tickets" ON support_tickets;
DROP POLICY IF EXISTS "admin_and_support_manage_tickets" ON support_tickets;
DROP POLICY IF EXISTS "staff_manage_tickets" ON support_tickets;
DROP POLICY IF EXISTS "users_read_own_notifications" ON notifications;
DROP POLICY IF EXISTS "drivers_read_own_earnings" ON driver_earnings;
DROP POLICY IF EXISTS "admins_read_ratings" ON ratings;
DROP POLICY IF EXISTS "admins_read_driver_earnings" ON driver_earnings;
DROP POLICY IF EXISTS "admins_manage_promos" ON promo_codes;
DROP POLICY IF EXISTS "admins_read_promotion_redemptions" ON promotion_redemptions;
DROP POLICY IF EXISTS "staff_manage_promos" ON promo_codes;
DROP POLICY IF EXISTS "admins_read_audit_logs" ON admin_audit_logs;
DROP POLICY IF EXISTS "staff_read_internal_ticket_comments" ON support_ticket_comments;
DROP POLICY IF EXISTS "staff_create_internal_ticket_comments" ON support_ticket_comments;
DROP POLICY IF EXISTS "admins_read_refund_operations" ON refund_operations;
DROP POLICY IF EXISTS "support_conversation_read_scoped" ON support_conversation_entries;
DROP POLICY IF EXISTS "staff_create_requester_conversation_replies" ON support_conversation_entries;

CREATE POLICY "profiles_are_self_or_staff" ON profiles FOR SELECT
USING (id = public.current_profile_id() OR public.current_profile_role() = 'admin');
CREATE POLICY "customers_manage_own_addresses" ON customer_addresses FOR ALL
USING (customer_id = public.current_profile_id()) WITH CHECK (customer_id = public.current_profile_id());
CREATE POLICY "customers_manage_own_contacts" ON contacts FOR ALL
USING (customer_id = public.current_profile_id()) WITH CHECK (customer_id = public.current_profile_id());
CREATE POLICY "drivers_read_own_profile" ON drivers FOR SELECT
USING (profile_id = public.current_profile_id() OR public.current_profile_role() = 'admin');
CREATE POLICY "drivers_read_own_documents" ON driver_documents FOR SELECT
USING (driver_id = public.current_driver_id() OR public.current_profile_role() = 'admin');
CREATE POLICY "admins_read_driver_applications" ON driver_applications FOR SELECT
USING (public.current_profile_role() = 'admin');
CREATE POLICY "admins_read_driver_incidents" ON driver_incidents FOR SELECT
USING (public.current_profile_role() = 'admin');
CREATE POLICY "drivers_read_own_incidents" ON driver_incidents FOR SELECT
USING (driver_id = public.current_driver_id());
CREATE POLICY "support_conversation_read_scoped" ON support_conversation_entries FOR SELECT
USING (
  public.current_profile_role() IN ('admin','support')
  OR (
    visibility = 'requester'
    AND (
      EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = support_ticket_id AND t.customer_id = public.current_profile_id())
      OR EXISTS (SELECT 1 FROM driver_incidents i JOIN drivers d ON d.id = i.driver_id WHERE i.id = driver_incident_id AND d.profile_id = public.current_profile_id())
    )
  )
);
CREATE POLICY "staff_create_requester_conversation_replies" ON support_conversation_entries FOR INSERT
WITH CHECK (
  author_profile_id = public.current_profile_id()
  AND visibility = 'requester'
  AND (
    public.current_profile_role() IN ('admin','support')
    OR EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = support_ticket_id AND t.customer_id = public.current_profile_id())
    OR EXISTS (SELECT 1 FROM driver_incidents i JOIN drivers d ON d.id = driver_incident_id AND d.profile_id = public.current_profile_id())
  )
);
CREATE POLICY "customers_read_own_deliveries" ON deliveries FOR SELECT
USING (customer_id = public.current_profile_id());
CREATE POLICY "drivers_read_assigned_deliveries" ON deliveries FOR SELECT
USING (driver_id = public.current_driver_id());
CREATE POLICY "admins_read_deliveries" ON deliveries FOR SELECT
USING (public.current_profile_role() = 'admin');
CREATE POLICY "customers_read_own_history" ON delivery_status_history FOR SELECT
USING (EXISTS (SELECT 1 FROM deliveries d WHERE d.id = delivery_id AND d.customer_id = public.current_profile_id()));
CREATE POLICY "drivers_read_assigned_history" ON delivery_status_history FOR SELECT
USING (EXISTS (SELECT 1 FROM deliveries d WHERE d.id = delivery_id AND d.driver_id = public.current_driver_id()));
CREATE POLICY "drivers_insert_own_locations" ON driver_locations FOR INSERT
WITH CHECK (
  driver_id = public.current_driver_id()
  AND EXISTS (
    SELECT 1 FROM deliveries d
    WHERE d.id = delivery_id
      AND d.driver_id = public.current_driver_id()
      AND d.delivery_status NOT IN ('delivered','cancelled','failed','refunded')
  )
);
CREATE POLICY "delivery_participants_read_photos" ON delivery_photos FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM deliveries d
    WHERE d.id = delivery_id
      AND (
        d.customer_id = public.current_profile_id()
        OR d.driver_id = public.current_driver_id()
        OR public.current_profile_role() IN ('admin','dispatcher')
      )
  )
);
CREATE POLICY "delivery_participants_attach_photos" ON delivery_photos FOR INSERT
WITH CHECK (
  uploaded_by_profile_id = public.current_profile_id()
  AND EXISTS (
    SELECT 1 FROM deliveries d
    WHERE d.id = delivery_id
      AND (
        d.customer_id = public.current_profile_id()
        OR d.driver_id = public.current_driver_id()
      )
  )
);
CREATE POLICY "delivery_participants_create_photo_uploads" ON delivery_photo_uploads FOR INSERT
WITH CHECK (
  uploader_profile_id = public.current_profile_id()
  AND EXISTS (
    SELECT 1 FROM deliveries d
    WHERE d.id = delivery_id
      AND (
        d.customer_id = public.current_profile_id()
        OR d.driver_id = public.current_driver_id()
      )
  )
);
CREATE POLICY "customers_read_own_quotes" ON delivery_quotes FOR SELECT
USING (customer_id = public.current_profile_id());
CREATE POLICY "customers_read_own_payments" ON payments FOR SELECT
USING (customer_id = public.current_profile_id());
CREATE POLICY "admins_read_payments" ON payments FOR SELECT
USING (public.current_profile_role() = 'admin');
CREATE POLICY "customers_create_own_tickets" ON support_tickets FOR INSERT
WITH CHECK (customer_id = public.current_profile_id());
CREATE POLICY "customers_read_own_tickets" ON support_tickets FOR SELECT
USING (customer_id = public.current_profile_id());
CREATE POLICY "admin_and_support_manage_tickets" ON support_tickets FOR ALL
USING (public.current_profile_role() IN ('admin','support'))
WITH CHECK (public.current_profile_role() IN ('admin','support'));
CREATE POLICY "users_read_own_notifications" ON notifications FOR SELECT
USING (
  profile_id = public.current_profile_id()
  AND (
    support_ticket_id IS NULL
    OR EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = support_ticket_id AND t.customer_id = public.current_profile_id()
    )
  )
  AND (
    driver_incident_id IS NULL
    OR EXISTS (
      SELECT 1 FROM driver_incidents i
      WHERE i.id = driver_incident_id AND i.driver_id = public.current_driver_id()
    )
  )
);
CREATE POLICY "drivers_read_own_earnings" ON driver_earnings FOR SELECT
USING (driver_id = public.current_driver_id());
CREATE POLICY "admins_read_ratings" ON ratings FOR SELECT
USING (public.current_profile_role() = 'admin');
CREATE POLICY "admins_read_driver_earnings" ON driver_earnings FOR SELECT
USING (public.current_profile_role() = 'admin');
CREATE POLICY "admins_manage_promos" ON promo_codes FOR ALL
USING (public.current_profile_role() = 'admin')
WITH CHECK (public.current_profile_role() = 'admin');
CREATE POLICY "admins_read_promotion_redemptions" ON promotion_redemptions FOR SELECT
USING (public.current_profile_role() = 'admin');
CREATE POLICY "admins_read_audit_logs" ON admin_audit_logs FOR SELECT
USING (public.current_profile_role() = 'admin');
CREATE POLICY "staff_read_internal_ticket_comments" ON support_ticket_comments FOR SELECT
USING (public.current_profile_role() IN ('admin','support'));
CREATE POLICY "staff_create_internal_ticket_comments" ON support_ticket_comments FOR INSERT
WITH CHECK (
  public.current_profile_role() IN ('admin','support')
  AND author_profile_id = public.current_profile_id()
);
CREATE POLICY "admins_read_refund_operations" ON refund_operations FOR SELECT
USING (public.current_profile_role() = 'admin');
ALTER TABLE driver_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_bonus_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_delivery_offer_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drivers_read_own_bonuses" ON driver_bonuses;
DROP POLICY IF EXISTS "admins_read_driver_bonuses" ON driver_bonuses;
DROP POLICY IF EXISTS "drivers_read_own_bonus_events" ON driver_bonus_events;
DROP POLICY IF EXISTS "admins_read_driver_bonus_events" ON driver_bonus_events;
DROP POLICY IF EXISTS "drivers_read_own_offer_attempts" ON driver_delivery_offer_attempts;
CREATE POLICY "drivers_read_own_bonuses" ON driver_bonuses FOR SELECT
USING (driver_id = public.current_driver_id());
CREATE POLICY "drivers_read_own_bonus_events" ON driver_bonus_events FOR SELECT
USING (
  EXISTS (SELECT 1 FROM driver_bonuses b WHERE b.id = bonus_id AND b.driver_id = public.current_driver_id())
);
CREATE POLICY "drivers_read_own_offer_attempts" ON driver_delivery_offer_attempts FOR SELECT
USING (driver_id = public.current_driver_id());