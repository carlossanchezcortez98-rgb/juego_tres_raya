// Configuración de Supabase (Project Settings → API).
// La anon key es pública por diseño: la seguridad la aporta RLS (ver supabase/schema.sql).
// No pongas aquí la service_role key.
// Si url o anonKey están vacíos, el juego funciona igual pero sin guardar nada.
window.SUPABASE_CONFIG = {
  url: 'https://txzsfjyvtuwptyazetur.supabase.co',
  anonKey: 'sb_publishable_a6DZMfLK9a0rhAmyAX0Alg_OjYmW6X9',
};
