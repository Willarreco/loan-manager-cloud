const SUPABASE_URL = 'https://pqdqumgplcwmzctcmxzc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxZHF1bWdwbGN3bXpjdGNteHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODQzMTgsImV4cCI6MjA5Mjk2MDMxOH0.SEZ2VCaS5YDUG7TazFB5E3T2XYP19dC4ciqeoQcEG-M';

// Exportar para uso em outros arquivos
window.supabaseConfig = {
    url: SUPABASE_URL,
    key: SUPABASE_ANON_KEY
};
