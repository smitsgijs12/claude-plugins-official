// Supabase-gegevens van jullie project (Project Settings > API, of Connect > App frameworks).
// supabaseKey is de publishable key (of de oudere anon key). Die is bedoeld voor in de browser.
// Zet hier NOOIT de service_role- of secret key: die geeft volledige toegang tot de database.
// De app weigert zo'n sleutel en laat dan een melding zien.
window.TURFLIJST_CONFIG = {
  supabaseUrl: "",
  supabaseKey: "",
  // Optioneel: het vaste adres dat je deelt, bv. "https://turflijst.vercel.app".
  // De uitnodigingslink gebruikt dan altijd dit adres. Leeg = het adres waarop je de site nu open hebt.
  appUrl: ""
};
