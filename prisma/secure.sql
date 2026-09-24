-- נעילת הגישה הישירה למסד מבחוץ.
--
-- Supabase חושף כל טבלה בסכימת public דרך REST, והמפתח הציבורי מגיע לדפדפן.
-- בלי השורות האלה כל מי שמחזיק במפתח — כלומר כל מי שפתח את האתר — יכול לקרוא
-- את כל המסמכים ישירות, בלי לעבור דרך ההתחברות.
--
-- האפליקציה עצמה אינה נפגעת: היא מתחברת ב-Prisma כבעלת הטבלאות, ועליה RLS
-- אינו נאכף. הפעלת RLS בלי מדיניות כלשהי משמעה: דרך REST אין גישה בכלל.

ALTER TABLE public.businesses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vat_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- שכבה שנייה: שלילת ההרשאות מהתפקידים שה-REST משתמש בהם.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
